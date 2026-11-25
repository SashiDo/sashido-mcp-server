import { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { Access, annotationsFor, isToolAllowed } from "./access.js";
import { ParseClient } from "./client/parse.js";
import { App, SashidoClient } from "./client/sashido.js";
import { appConfig } from "./config.js";
import { logToolCall, newRequestId, runToolCall } from "./audit.js";

/**
 * The AI client calling, e.g. "claude-code/2.1.0": from the MCP initialize
 * (stdio, SSE), or the HTTP request's User-Agent (stateless HTTP, where
 * each request has its own server).
 */
function clientOf(server: McpServer, extra: unknown): string | undefined {
  const info = server.server.getClientVersion();
  if (info && info.name) {
    return `${info.name}/${info.version || "?"}`.slice(0, 100);
  }
  const headers = ((extra as { requestInfo?: { headers?: Record<string, unknown> } }) || {}).requestInfo?.headers;
  const agent = headers && headers["user-agent"];
  return typeof agent === "string" ? agent.slice(0, 100) : undefined;
}

/**
 * What the tools of one MCP server instance work with: the access token of
 * the request (HTTP) or of the local user (stdio), and what it may do.
 */
export interface ToolContext {
  token: string;
  access: Access;
  /** The SashiDo API with the token */
  sashido(): SashidoClient;
  /** An app's Parse Server, through the API's proxy */
  parse(appObjectId: string): ParseClient;
  /** The app's name, for messages */
  appName(appObjectId: string): Promise<string>;
  /** An app's objectId from its objectId or its name */
  resolveApp(value: string): Promise<string>;
  /**
   * Set when the server runs without an access token (see stdio.ts): the
   * tools are listed, and every call answers with this instead of running.
   */
  needsToken?: string;
}

export function createToolContext(
  token: string,
  access: Access,
  apiUrl: string = appConfig.sashido.apiUrl,
): ToolContext {
  const assertApp = (appObjectId: string) => {
    if (access.appIds && access.appIds.indexOf(appObjectId) === -1) {
      // the API refuses it too; this says why up front
      throw new Error(
        `This connection is limited to other apps (${access.appIds.join(", ")}).`,
      );
    }
  };

  // one server instance serves one request (HTTP) or one user (stdio)
  let apps: Promise<App[] | null> | null = null;
  const listApps = () => {
    if (!apps) {
      apps =
        access.scopes.indexOf("account:read") === -1
          ? Promise.resolve(null)
          : new SashidoClient(token, apiUrl).listApps().catch(() => null);
    }
    return apps;
  };

  return {
    token,
    access,
    sashido: () => new SashidoClient(token, apiUrl),
    parse: (appObjectId: string) => {
      assertApp(appObjectId);
      return new ParseClient(token, appObjectId, apiUrl);
    },
    appName: async (appObjectId: string) => {
      const app = ((await listApps()) || []).find((a) => a.objectId === appObjectId);
      return app ? app.name : appObjectId;
    },
    resolveApp: async (value: string) => {
      const known = await listApps();
      // without account:read the apps can't be listed: take it as an id
      if (!known || known.some((a) => a.objectId === value)) {
        return value;
      }
      const named = known.filter((a) => a.name.toLowerCase() === value.trim().toLowerCase());
      if (named.length === 1) {
        return named[0]!.objectId;
      }
      if (named.length > 1) {
        throw new Error(
          `Several apps are named "${value}": ${named.map((a) => a.objectId).join(", ")}. Use the objectId.`,
        );
      }
      throw new Error(
        `No app "${value}". Your apps: ${known.map((a) => `${a.name} (${a.objectId})`).join(", ") || "none"}.`,
      );
    },
  };
}

/** server.tool(name, description, schema, handler), as the SDK types it */
export interface ToolServer {
  tool<Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    schema: Args,
    handler: ToolCallback<Args>,
  ): void;
}

/**
 * Many tools catch their errors and answer "❌ ..." or "Error ...": mark
 * those as errors, so clients and models know the call failed (thrown
 * errors the SDK marks itself).
 */
function markErrors(result: unknown): unknown {
  const r = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  const first = r && r.content && r.content[0];
  if (first && first.type === "text" && /^\s*(❌|Error\b)/.test(first.text || "") && r.isError === undefined) {
    return { ...r, isError: true };
  }
  return result;
}

const APP_FIELD =z.string().describe("The app: its name or objectId (see list_apps)");

/**
 * Registers a group's tools on the MCP server, but only those the access
 * allows (see access.ts), each with annotations so clients can ask before
 * changes and deletions. Tools taking appObjectId accept an app's name too.
 */
export function toolServer(
  server: McpServer,
  group: string,
  access: Access,
  registered: string[] = [],
  ctx?: ToolContext,
): ToolServer {
  return {
    tool(name, description, schema, handler) {
      if (!isToolAllowed(name, group, access)) {
        return;
      }
      registered.push(name);

      let finalSchema: ZodRawShapeCompat = schema;
      let call = handler as (args: unknown, extra: unknown) => unknown;
      if (ctx && "appObjectId" in schema) {
        finalSchema = { ...schema, appObjectId: APP_FIELD };
        const inner = call;
        call = async (args: unknown, extra: unknown) => {
          const input = args as { appObjectId: string };
          const appObjectId = await ctx.resolveApp(input.appObjectId);
          return inner({ ...input, appObjectId }, extra);
        };
      }
      const finalHandler = async (args: unknown, extra: unknown) => {
        if (ctx && ctx.needsToken) {
          return { content: [{ type: "text" as const, text: ctx.needsToken }], isError: true };
        }
        const toolCall = {
          tool: name,
          mcpClient: clientOf(server, extra),
          requestId: newRequestId(),
        };
        const started = Date.now();
        let result: unknown;
        try {
          result = markErrors(await runToolCall(toolCall, async () => call(args, extra)));
          return result;
        } finally {
          const input = args as { appObjectId?: unknown };
          logToolCall({
            ...toolCall,
            token: ctx ? ctx.token : "",
            app: typeof input.appObjectId === "string" ? input.appObjectId : undefined,
            ok: !!result && !(result as { isError?: boolean }).isError,
            durationMs: Date.now() - started,
          });
        }
      };
      server.tool(name, description, finalSchema, annotationsFor(name), finalHandler as ToolCallback<typeof finalSchema>);
    },
  };
}
