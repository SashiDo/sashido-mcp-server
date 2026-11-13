import express, { NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { narrowAccess } from "../access.js";
import {
  AuthError,
  accessFromTokenInfo,
  bearerToken,
  getTokenInfo,
  tokenHash,
} from "../auth.js";
import { appConfig } from "../config.js";
import { createToolContext } from "../context.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../server.js";
import {
  closeRedisConnection,
  getRedisClient,
  isRedisConfigured,
  pingRedis,
} from "../session/redis-client.js";
import { deleteSession, registerSession, touchSession } from "../session/session-manager.js";
import {
  closePubSub,
  publishToSession,
  subscribeToSession,
  unsubscribeFromSession,
} from "../session/sse-pubsub.js";

// SSE connections held by this instance (an SSE stream lives on one instance)
const sseTransports = new Map<string, SSEServerTransport>();

function jsonRpcError(res: Response, status: number, message: string): void {
  if (!res.headersSent) {
    res.status(status).json({
      jsonrpc: "2.0",
      error: { code: status === 401 ? -32001 : -32000, message },
      id: null,
    });
  }
}

/**
 * Browsers send Origin; only allowed origins may call the server (CORS and
 * protection against DNS rebinding to a local server). Other clients send
 * no Origin and are let through to authentication.
 */
function originCheck(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin) {
    return next();
  }
  if (appConfig.server.allowedOrigins.indexOf(origin) === -1) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, mcp-protocol-version");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

/** A fixed one-minute window per client IP, kept in this process. */
function rateLimit(limitPerMinute: number) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip || "unknown";
    let window = windows.get(key);
    if (!window || now - window.startedAt >= 60000) {
      if (windows.size > 10000) windows.clear();
      window = { startedAt: now, count: 0 };
      windows.set(key, window);
    }
    window.count++;
    if (window.count > limitPerMinute) {
      res.setHeader("Retry-After", String(Math.ceil((window.startedAt + 60000 - now) / 1000)));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}

/**
 * The tools for this request's token: its scopes and apps, narrowed by the
 * URL options ?read_only=true&apps=id1,id2&features=objects,logs
 */
async function contextFor(req: Request) {
  const token = bearerToken(req.headers.authorization);
  const info = await getTokenInfo(token);
  const query = req.query as Record<string, string | undefined>;
  const access = narrowAccess(accessFromTokenInfo(info, false), {
    readOnly: query["read_only"],
    apps: query["apps"],
    features: query["features"],
  });
  return { token, ctx: createToolContext(token, access) };
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AuthError) {
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    jsonRpcError(res, error.statusCode, error.message);
    return;
  }
  // the details stay in the logs
  console.error(`[MCP] ${label}:`, error instanceof Error ? error.message : error);
  jsonRpcError(res, 500, "Internal error");
}

export function createHttpApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  if (appConfig.server.trustProxy) {
    app.set("trust proxy", true);
  }
  app.use(originCheck);

  app.get("/health", async (_req, res) => {
    res.json({
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      sseConnections: sseTransports.size,
      redis: isRedisConfigured() ? { healthy: await pingRedis() } : null,
    });
  });

  app.use(rateLimit(appConfig.server.rateLimitPerMinute));
  app.use(express.json({ limit: "1mb" }));

  // ============================================
  // Streamable HTTP: stateless. Every request brings its token and gets a
  // server with the tools that token allows; any instance can answer.
  // ============================================
  app.post("/mcp", async (req, res) => {
    try {
      const { ctx } = await contextFor(req);
      const server = createServer(ctx);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        // one JSON answer per request: nothing here streams progress
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      handleError(res, error, "/mcp");
    }
  });

  // stateless: no session to stream to or to end
  app.get("/mcp", (_req, res) => jsonRpcError(res, 405, "Method not allowed. POST JSON-RPC messages to /mcp."));
  app.delete("/mcp", (_req, res) => jsonRpcError(res, 405, "Method not allowed."));

  // ============================================
  // SSE (older clients, e.g. some n8n versions): the stream stays on the
  // instance that opened it. Messages must come with the same token; with
  // Redis they may arrive at another instance and are forwarded.
  // ============================================
  app.get("/sse", async (req, res) => {
    try {
      const { token, ctx } = await contextFor(req);
      const transport = new SSEServerTransport("/sse/messages", res);
      const sessionId = transport.sessionId;
      sseTransports.set(sessionId, transport);
      await registerSession(sessionId, tokenHash(token));

      await subscribeToSession(sessionId, async (message: string) => {
        try {
          await transport.handleMessage(JSON.parse(message));
        } catch (err) {
          console.error("[SSE] forwarded message:", err instanceof Error ? err.message : err);
        }
      });

      transport.onclose = () => {
        sseTransports.delete(sessionId);
        unsubscribeFromSession(sessionId).catch(() => undefined);
        deleteSession(sessionId).catch(() => undefined);
      };

      const server = createServer(ctx);
      await server.connect(transport);
    } catch (error) {
      handleError(res, error, "/sse");
    }
  });

  app.post("/sse/messages", async (req, res) => {
    try {
      const sessionId = typeof req.query["sessionId"] === "string" ? req.query["sessionId"] : "";
      const token = bearerToken(req.headers.authorization);
      const session = sessionId ? await touchSession(sessionId) : null;
      if (!session) {
        res.status(404).json({ error: "Session not found. Connect again via GET /sse." });
        return;
      }
      // only the token that opened the session may use it
      if (session.tokenHash !== tokenHash(token)) {
        res.status(403).json({ error: "This session belongs to another token." });
        return;
      }

      const transport = sseTransports.get(sessionId);
      if (transport) {
        await transport.handlePostMessage(req, res, req.body);
        return;
      }
      if (isRedisConfigured() && (await publishToSession(sessionId, JSON.stringify(req.body)))) {
        res.status(202).json({ status: "accepted" });
        return;
      }
      res.status(503).json({ error: "The SSE connection is gone. Connect again via GET /sse." });
    } catch (error) {
      handleError(res, error, "/sse/messages");
    }
  });

  return app;
}

export async function startHttpServer(): Promise<void> {
  if (isRedisConfigured()) {
    try {
      await getRedisClient();
    } catch (err) {
      console.error("[MCP] Redis connection failed, using in-memory sessions:", err);
    }
  }

  const app = createHttpApp();
  const { host, port } = appConfig.server;

  return new Promise((_resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.error(`[MCP] HTTP server listening on ${host}:${port}`);
      console.error(`[MCP]   POST /mcp          - Streamable HTTP (stateless)`);
      console.error(`[MCP]   GET  /sse          - SSE`);
      console.error(`[MCP]   POST /sse/messages - SSE messages`);
      console.error(`[MCP]   GET  /health       - Health check`);
    });
    server.on("error", reject);

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.error("\n[MCP] Shutting down...");
      for (const transport of sseTransports.values()) {
        await transport.close().catch(() => undefined);
      }
      sseTransports.clear();
      await closePubSub();
      await closeRedisConnection();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 3000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
