import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { MCP_URL, Shell, TOKEN_ENV, bundledSkillsDir, install, runCommand, standaloneSkill, status, uninstall } from "../src/install/index.js";
import { SERVER_VERSION } from "../src/version.js";

// The installer writes into a person's home folder and runs their editors'
// own commands. Here the home is a temporary folder and the commands are
// only recorded.

let home: string;
let ran: string[];
let lines: string[];
let present: string[];

const shell: Shell = {
  run(command, args, env) {
    if (present.indexOf(command) === -1) {
      return null;
    }
    ran.push(`${command} ${args.join(" ")}${env ? ` [${Object.keys(env).join(",")}]` : ""}`);
    return { status: 0, output: "" };
  },
};
const options = () => ({ home, shell, log: (l: string) => lines.push(l) });
const everything = () => lines.join("\n") + ran.join("\n") + JSON.stringify(readTree(home));

function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      out[path] = readFileSync(path, "utf8");
    }
  }
  return out;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sashido-install-"));
  ran = [];
  lines = [];
  present = ["claude", "codex"];
});

describe("install", () => {
  it("gives Claude Code the plugin, over HTTPS, and says the step that is left", () => {
    const { done } = install(["claude"], options());
    expect(done).toEqual(["claude"]);
    // a plugin that was already installed stays at its old version on "install": the update follows
    expect(ran).toEqual([
      "claude plugin install sashido --marketplace sashido/sashido-mcp-server [CLAUDE_CODE_PLUGIN_PREFER_HTTPS]",
      "claude plugin marketplace update sashido [CLAUDE_CODE_PLUGIN_PREFER_HTTPS]",
      "claude plugin update sashido@sashido [CLAUDE_CODE_PLUGIN_PREFER_HTTPS]",
    ]);
    expect(lines.join("\n")).toMatch(/\/plugin configure sashido@sashido/);
    // the plugin carries its own skills: none are copied
    expect(existsSync(join(home, ".agents"))).toBe(false);
  });

  it("updates the plugin when it installed it before", () => {
    install(["claude"], options());
    ran = [];
    install(["claude"], options());
    expect(ran).toEqual([
      "claude plugin marketplace update sashido [CLAUDE_CODE_PLUGIN_PREFER_HTTPS]",
      "claude plugin update sashido@sashido [CLAUDE_CODE_PLUGIN_PREFER_HTTPS]",
    ]);
  });

  it("connects Cursor with the token read from the environment, keeping the servers already there", () => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { url: "https://example.com/mcp" } } }));
    install(["cursor"], options());
    const config = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
    expect(config.mcpServers.other).toEqual({ url: "https://example.com/mcp" });
    expect(config.mcpServers.sashido).toEqual({ url: MCP_URL, headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` } });
  });

  it("leaves alone a sashido server it didn't write, and a config it can't read", () => {
    mkdirSync(join(home, ".cursor"));
    const mine = JSON.stringify({ mcpServers: { sashido: { command: "npx", args: ["@sashido/mcp-server"] } } });
    writeFileSync(join(home, ".cursor", "mcp.json"), mine);
    install(["cursor"], options());
    expect(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).toBe(mine);

    writeFileSync(join(home, ".cursor", "mcp.json"), "{ not json");
    const { failed } = install(["cursor"], options());
    expect(failed).toEqual(["cursor"]);
    expect(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).toBe("{ not json");
  });

  it("copies every skill where Cursor and Codex read them, named apart from other vendors' skills", () => {
    install(["cursor", "codex"], options());
    const names = readdirSync(bundledSkillsDir());
    expect(names.length).toBeGreaterThan(0);
    expect(readdirSync(join(home, ".agents", "skills")).sort()).toEqual(names.map((n) => `sashido-${n}`).sort());
    const entry = readFileSync(join(home, ".agents", "skills", "sashido-backend", "SKILL.md"), "utf8");
    // a skill's name must be its folder's, and it must point to its siblings by the names they have here
    expect(entry).toMatch(/^---\nname: sashido-backend\n/);
    expect(entry).toContain("`sashido-new-backend`");
    expect(entry).not.toContain("| `new-backend` |");
    expect(ran).toContain(`codex mcp add sashido --url ${MCP_URL} --bearer-token-env-var ${TOKEN_ENV}`);
  });

  it("adds the server to Codex's config when its command isn't there, once, keeping what the file holds", () => {
    present = [];
    mkdirSync(join(home, ".codex"));
    const file = join(home, ".codex", "config.toml");
    writeFileSync(file, 'model = "x"');
    const { done } = install(["codex"], options());
    expect(done).toEqual(["codex"]);
    const config = readFileSync(file, "utf8");
    expect(config.startsWith('model = "x"\n')).toBe(true);
    expect(config).toContain(`[mcp_servers.sashido]\nurl = "${MCP_URL}"\nbearer_token_env_var = "${TOKEN_ENV}"`);

    install(["codex"], options());
    expect(readFileSync(file, "utf8")).toBe(config);

    uninstall(options());
    expect(readFileSync(file, "utf8")).toBe('model = "x"\n');
  });

  it("leaves alone a sashido section someone wrote in Codex's config", () => {
    present = [];
    mkdirSync(join(home, ".codex"));
    const mine = '[mcp_servers.sashido]\ncommand = "npx"\n';
    writeFileSync(join(home, ".codex", "config.toml"), mine);
    install(["codex"], options());
    uninstall(options());
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toBe(mine);
  });

  it("never replaces a skill folder that was there before", () => {
    const theirs = join(home, ".agents", "skills", "sashido-backend");
    mkdirSync(theirs, { recursive: true });
    writeFileSync(join(theirs, "SKILL.md"), "theirs");
    install(["cursor"], options());
    expect(readFileSync(join(theirs, "SKILL.md"), "utf8")).toBe("theirs");
    uninstall(options());
    expect(readFileSync(join(theirs, "SKILL.md"), "utf8")).toBe("theirs");
  });

  it("never asks for the token, never writes one, and says why", () => {
    process.env[TOKEN_ENV] = "sashido_pat_abcdefghijklmnopqrstuvwxyz0123456789";
    try {
      install(["claude", "cursor", "codex"], options());
      status(options());
      expect(everything()).not.toContain("sashido_pat_abcdefghijklmnopqrstuvwxyz0123456789");
      expect(lines.join("\n")).toMatch(/never asks for the token and never writes it to a file/);
    } finally {
      delete process.env[TOKEN_ENV];
    }
  });

  it("changes nothing in a dry run", () => {
    install(["claude", "cursor", "codex"], { ...options(), dryRun: true });
    // asking a program for its version is the only thing it may run
    expect(ran).toEqual(["codex --version"]);
    expect(readTree(home)).toEqual({});
    expect(lines.join("\n")).toMatch(/dry run/);
    expect(lines.join("\n")).toContain("~/.agents/skills/sashido-backend");
    expect(lines.join("\n")).not.toContain(home);
  });
});

describe("uninstall and status", () => {
  it("removes exactly what install wrote", () => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { url: "https://example.com/mcp" } } }));
    const others = join(home, ".agents", "skills", "someone-elses");
    mkdirSync(others, { recursive: true });
    writeFileSync(join(others, "SKILL.md"), "x");

    install(["claude", "cursor", "codex"], options());
    ran = [];
    uninstall(options());

    expect(readdirSync(join(home, ".agents", "skills"))).toEqual(["someone-elses"]);
    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"))).toEqual({ mcpServers: { other: { url: "https://example.com/mcp" } } });
    expect(ran.filter((r) => r.indexOf("uninstall") !== -1)).toEqual(["claude plugin uninstall sashido@sashido"]);
    expect(existsSync(join(home, ".sashido", "agents.json"))).toBe(false);
  });

  it("says what is installed and in which version", () => {
    status(options());
    expect(lines.join("\n")).toMatch(/Nothing was installed/);
    lines = [];
    install(["cursor"], options());
    lines = [];
    status(options());
    expect(lines.join("\n")).toContain(`Installed version ${SERVER_VERSION}`);
    expect(lines.join("\n")).toMatch(/Editors: cursor/);
  });
});

describe("the command line", () => {
  it("installs for the editors found on the machine, or the ones named", async () => {
    mkdirSync(join(home, ".cursor"));
    present = [];
    expect(await runCommand(["install"], options())).toBe(true);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(true);
    expect(ran).toEqual([]);

    present = ["claude"];
    expect(await runCommand(["install", "--claude"], options())).toBe(true);
    expect(ran.length).toBe(3);
  });

  it("leaves everything else to the server itself", async () => {
    expect(await runCommand([], options())).toBe(false);
    expect(await runCommand(["--transport=http"], options())).toBe(false);
  });
});

describe("a skill outside the plugin", () => {
  it("carries the prefix in its name and in every mention of a sibling", () => {
    const out = standaloneSkill("---\nname: backend\ndescription: x\n---\nUse `diagnose`, then `get_app`.", ["backend", "diagnose"]);
    expect(out).toBe("---\nname: sashido-backend\ndescription: x\n---\nUse `sashido-diagnose`, then `get_app`.");
  });
});
