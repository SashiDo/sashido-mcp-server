import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { SERVER_VERSION } from "./version.js";

/**
 * The tool call an API request belongs to. Every request to the SashiDo
 * API carries it as headers, so the API's audit log (Activity) records that
 * it came through this server, from which AI client and tool. The API takes
 * them for the trace only, never for access.
 */
export interface ToolCall {
  tool: string;
  /** e.g. "claude-code/2.1.0" */
  mcpClient?: string;
  requestId: string;
}

const calls = new AsyncLocalStorage<ToolCall>();

export function runToolCall<T>(call: ToolCall, work: () => Promise<T>): Promise<T> {
  return calls.run(call, work);
}

/** Headers for the API, for the tool call running now (if any) */
export function auditHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "X-SashiDo-Client": `mcp/${SERVER_VERSION}` };
  const call = calls.getStore();
  if (call) {
    headers["X-SashiDo-MCP-Tool"] = call.tool;
    headers["X-Request-Id"] = call.requestId;
    if (call.mcpClient) {
      headers["X-SashiDo-MCP-Client"] = call.mcpClient;
    }
  }
  return headers;
}

export function newRequestId(): string {
  return randomUUID();
}

/** A short, stable id of a token for logs: never the token */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

/**
 * One line of JSON per tool call on stderr (stdout carries the protocol
 * over stdio). No argument values: they can hold app data or secrets.
 */
export function logToolCall(entry: {
  requestId: string;
  tool: string;
  mcpClient?: string;
  token: string;
  app?: string;
  ok: boolean;
  durationMs: number;
}): void {
  const { token, ...rest } = entry;
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "tool_call",
      ...rest,
      token: tokenFingerprint(token),
    }),
  );
}
