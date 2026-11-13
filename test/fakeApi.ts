import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  authorization?: string;
  headers: Record<string, unknown>;
}

export interface FakeApi {
  url: string;
  requests: RecordedRequest[];
  /** token -> what GET /tokens/current answers for it */
  tokens: Map<string, { scopes: string[]; appIds: string[] | null }>;
  /** method + path -> JSON answer (default {}); ErrorAnswer for errors; a function for answers that change */
  answers: Map<string, unknown>;
  close(): Promise<void>;
}

/** A stand-in SashiDo API that records every request. */
export async function startFakeApi(): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const tokens = new Map<string, { scopes: string[]; appIds: string[] | null }>();
  const answers = new Map<string, unknown>();
  const app = express();
  app.use(express.json());

  app.use((req, res) => {
    const authorization = req.headers.authorization;
    requests.push({
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      body: req.body,
      authorization,
      headers: req.headers,
    });
    const token = (authorization || "").replace(/^Bearer /, "");
    const info = tokens.get(token);
    if (!info) {
      res.status(401).json({ code: 300, message: "invalid token" });
      return;
    }
    if (req.method === "GET" && req.path === "/tokens/current") {
      res.json({
        data: {
          id: "tok1",
          name: "test",
          ...info,
          expiresAt: null,
          user: { objectId: "u1", username: "dev@example.com" },
        },
      });
      return;
    }
    const key = `${req.method} ${req.path}`;
    let answer = answers.has(key) ? answers.get(key) : {};
    // a function answers each call anew, e.g. a deployment that ends
    if (typeof answer === "function") {
      answer = (answer as () => unknown)();
    }
    if (answer instanceof ErrorAnswer) {
      if (typeof answer.body === "string") {
        res.status(answer.status).send(answer.body);
      } else {
        res.status(answer.status).json(answer.body);
      }
      return;
    }
    res.json(answer);
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    tokens,
    answers,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export const token = (n: number) => `sashido_pat_${String(n).padStart(36, "a")}`;

/** An answer with an error status */
export class ErrorAnswer {
  constructor(
    public status: number,
    public body: unknown,
  ) {}
}
