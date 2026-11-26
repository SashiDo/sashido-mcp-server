import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { doctor } from "../src/install/doctor.js";
import { Shell, TOKEN_ENV, install } from "../src/install/index.js";
import { SERVER_VERSION } from "../src/version.js";

// The setup is a temporary home folder, the editors' commands are answers
// written here, and the server is a function.

let home: string;
let lines: string[];
let pluginList: string | null;
let health: () => Response;
let tools: (auth: string) => Response;
let asked: Array<{ url: string; auth?: string }>;

const shell: Shell = {
  run(command, args) {
    if (command !== "claude" || pluginList === null) {
      return null;
    }
    return { status: 0, output: args[1] === "list" ? pluginList : "" };
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
  asked.push({ url: String(url), auth });
  return String(url).endsWith("/health") ? health() : tools(auth ?? "");
}) as unknown as typeof fetch;
const run = (env: Record<string, string | undefined> = {}) => doctor({ home, shell, env, fetch: fakeFetch, log: (l) => lines.push(l) });
const out = () => lines.join("\n");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sashido-doctor-"));
  lines = [];
  asked = [];
  pluginList = `  ❯ sashido@sashido\n    Version: ${SERVER_VERSION}\n    Scope: user\n`;
  health = () => json({ status: "ok", version: SERVER_VERSION });
  tools = () => json({ result: { tools: new Array(31).fill({}) } });
});

describe("doctor", () => {
  it("says everything is in place when it is", async () => {
    mkdirSync(join(home, ".claude"));
    install(["cursor", "codex"], { home, shell, log: () => undefined });
    expect(await run({ [TOKEN_ENV]: "sashido_pat_x" })).toBe(true);
    expect(out()).toMatch(/Everything is in place/);
    expect(out()).toMatch(/it allows 31 tools/);
    expect(out()).toMatch(/plugin is installed \(version /);
    expect(out()).not.toMatch(/^[!✗]/m);
  });

  it("sends the token only to the SashiDo server and never prints it", async () => {
    mkdirSync(join(home, ".cursor"));
    await run({ [TOKEN_ENV]: "sashido_pat_secretsecret" });
    expect(asked.filter((a) => a.auth).map((a) => a.url)).toEqual(["https://mcp.sashido.io/mcp"]);
    expect(out()).not.toContain("sashido_pat_secretsecret");
  });

  it("names each thing that is missing, with the command that fixes it", async () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".codex"));
    pluginList = "  ❯ other@x\n    Version: 1.0.0\n";
    expect(await run({})).toBe(false);
    expect(out()).toMatch(/✗ Claude Code: the SashiDo plugin is not installed/);
    expect(out()).toMatch(/✗ Cursor: no `sashido` server/);
    expect(out()).toMatch(/✗ Codex: no \[mcp_servers\.sashido\]/);
    expect(out()).toMatch(/✗ Cursor and Codex: the SashiDo skills are not in/);
    expect(out()).toMatch(/✗ SASHIDO_ACCESS_TOKEN is not set/);
    expect(out()).toMatch(/install --cursor/);
    expect(out()).toMatch(/5 to fix/);
  });

  it("doesn't ask for the variable when only Claude Code is there", async () => {
    mkdirSync(join(home, ".claude"));
    expect(await run({})).toBe(true);
    expect(out()).toMatch(/nothing here needs it/);
  });

  it("tells a refused token from a missing one", async () => {
    mkdirSync(join(home, ".cursor"));
    tools = () => json({ error: { message: "Invalid token" } }, 401);
    expect(await run({ [TOKEN_ENV]: "sashido_pat_old" })).toBe(false);
    expect(out()).toMatch(/refuses the token/);
  });

  it("warns, without failing, about an old plugin, old skills and a newer release", async () => {
    mkdirSync(join(home, ".claude"));
    install(["cursor"], { home, shell, log: () => undefined });
    writeFileSync(join(home, ".agents", "skills", "sashido-backend", "SKILL.md"), "- These skills are version 0.0.1. x");
    pluginList = "  ❯ sashido@sashido\n    Version: 0.0.1\n";
    health = () => json({ status: "ok", version: "99.0.0" });
    expect(await run({ [TOKEN_ENV]: "sashido_pat_x" })).toBe(true);
    expect(out()).toMatch(/! Claude Code: the SashiDo plugin is version 0\.0\.1/);
    expect(out()).toMatch(/! Cursor and Codex: the SashiDo skills are version 0\.0\.1/);
    expect(out()).toMatch(/! This command is version .*; 99\.0\.0 is out/);
    expect(out()).toMatch(/3 worth a look/);
  });

  it("stops at the server when it can't be reached", async () => {
    mkdirSync(join(home, ".cursor"));
    health = () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    expect(await run({ [TOKEN_ENV]: "sashido_pat_x" })).toBe(false);
    expect(out()).toMatch(/can't be reached/);
    expect(asked.filter((a) => a.auth)).toEqual([]);
  });
});
