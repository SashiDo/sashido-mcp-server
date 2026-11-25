import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../src/version.js";

// The version and the registry name are written in several files that are
// released together: npm reads package.json, the MCP Registry reads
// server.json and checks it against the published package.

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

const pkg = read("package.json");
const lock = read("package-lock.json");
const server = read("server.json");

describe("what a release publishes", () => {
  it("has one version everywhere", () => {
    expect(pkg.version).toBe(SERVER_VERSION);
    expect(lock.version).toBe(SERVER_VERSION);
    expect(lock.packages[""].version).toBe(SERVER_VERSION);
    expect(server.version).toBe(SERVER_VERSION);
    expect(server.packages.map((p: { version: string }) => p.version)).toEqual([SERVER_VERSION]);
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
});
