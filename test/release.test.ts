import { readFileSync, readdirSync, statSync } from "fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../src/version.js";
import { TOOL_POLICY } from "../src/access.js";

// The version and the registry name are written in several files that are
// released together: npm reads package.json, the MCP Registry reads
// server.json and checks it against the published package.

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

const pkg = read("package.json");
const lock = read("package-lock.json");
const server = read("server.json");
const claudePlugin = read("plugins/sashido/.claude-plugin/plugin.json");
const cursorPlugin = read(".cursor-plugin/plugin.json");

describe("what a release publishes", () => {
  it("has one version everywhere", () => {
    expect(pkg.version).toBe(SERVER_VERSION);
    expect(lock.version).toBe(SERVER_VERSION);
    expect(lock.packages[""].version).toBe(SERVER_VERSION);
    expect(server.version).toBe(SERVER_VERSION);
    expect(server.packages.map((p: { version: string }) => p.version)).toEqual([SERVER_VERSION]);
    expect(claudePlugin.version).toBe(SERVER_VERSION);
    expect(cursorPlugin.version).toBe(SERVER_VERSION);
  });

  it("is the same server for npm and for the MCP Registry", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.packages[0].identifier).toBe(pkg.name);
  });

  it("fits the registry's limits", () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.title.length).toBeLessThanOrEqual(100);
  });

  it("keeps the plugins' secrets out of the files", () => {
    // the token is asked from the user, never written here
    expect(claudePlugin.userConfig.sashido_access_token.sensitive).toBe(true);
    expect(claudePlugin.mcpServers.sashido.headers.Authorization).toBe("Bearer ${user_config.sashido_access_token}");
    expect(read("mcp.json").mcpServers.sashido.headers.Authorization).toBe("Bearer ${SASHIDO_ACCESS_TOKEN}");
    expect(Object.keys(cursorPlugin.variables.properties)).toEqual(["SASHIDO_ACCESS_TOKEN"]);
  });
});

// Claude's directory takes only Markdown, JSON, YAML and images from the
// plugin's folder, and a skill that names a tool the server doesn't have
// sends the assistant looking for nothing.
describe("the plugin's skills", () => {
  const root = new URL("../plugins/sashido/", import.meta.url);
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => statSync(new URL(f, root)).isFile());
  const skills = files.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.split("\\").join("/")));
  const text = (f: string) => readFileSync(new URL(f, root), "utf8");

  it("holds only what the directory accepts", () => {
    const refused = files.filter((f) => !/(\.(md|json|ya?ml|png|jpe?g|svg|gif|webp)|(^|\/)LICENSE)$/i.test(f));
    expect(refused).toEqual([]);
  });

  it("names each skill after its folder and says when to use it", () => {
    expect(skills.length).toBeGreaterThan(0);
    for (const f of skills) {
      const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text(f));
      expect(front, f).not.toBeNull();
      expect(front![1]).toBe(f.split("/")[1]);
      expect(front![2].length, f).toBeLessThanOrEqual(1024);
    }
  });

  it("names only tools the server has", () => {
    const unknown: string[] = [];
    for (const f of skills) {
      for (const m of text(f).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        if (!(m[1] in TOOL_POLICY)) {
          unknown.push(`${f}: ${m[1]}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
