import { describe, expect, it } from "vitest";
import { Access, TOOL_POLICY, isToolAllowed, narrowAccess } from "../src/access.js";
import { createToolContext } from "../src/context.js";
import { createServer } from "../src/server.js";

const ALL_SCOPES = [
  "account:read", "apps:read", "apps:write", "deploy", "env:read",
  "env:write", "settings:read", "settings:write", "logs:read", "data:read", "data:write",
];

const access = (extra: Partial<Access> = {}): Access => ({
  scopes: ALL_SCOPES,
  appIds: null,
  readOnly: false,
  groups: null,
  local: true,
  ...extra,
});

const registeredWith = (a: Access) => {
  const registered: string[] = [];
  createServer(createToolContext("sashido_pat_x", a, "http://127.0.0.1:1"), registered);
  return registered;
};

describe("tool access", () => {
  it("has a policy for every tool, and no stale ones", () => {
    const registered = registeredWith(access()).sort();
    expect(registered).toEqual(Object.keys(TOOL_POLICY).sort());
  });

  it("shows only reading tools in read-only mode", () => {
    const registered = registeredWith(access({ readOnly: true }));
    expect(registered.length).toBeGreaterThan(10);
    registered.forEach((name) => expect(TOOL_POLICY[name]!.kind).toBe("read"));
    expect(registered).not.toContain("delete_object");
    expect(registered).toContain("query_objects");
  });

  it("shows only the tools of the token's scopes", () => {
    const registered = registeredWith(access({ scopes: ["logs:read"] }));
    expect(registered.sort()).toEqual(["get_error_logs", "get_logs"]);
  });

  it("keeps local file and URL uploads off remote servers", () => {
    expect(registeredWith(access({ local: false }))).not.toContain("upload_file_from_path");
    expect(registeredWith(access({ local: false }))).not.toContain("upload_file_from_url");
    expect(registeredWith(access({ local: true }))).toContain("upload_file_from_path");
  });

  it("limits tools to the chosen groups", () => {
    const registered = registeredWith(access({ groups: ["logs"] }));
    expect(registered.sort()).toEqual(["get_error_logs", "get_logs"]);
  });

  it("refuses unknown tools", () => {
    expect(isToolAllowed("drop_database", "objects", access())).toBe(false);
  });
});

describe("narrowing options", () => {
  it("can only narrow the token's apps", () => {
    const limited = access({ appIds: ["a1", "a2"] });
    expect(narrowAccess(limited, { apps: "a2,a3" }).appIds).toEqual(["a2"]);
    expect(narrowAccess(access(), { apps: "a3" }).appIds).toEqual(["a3"]);
    expect(narrowAccess(limited, {}).appIds).toEqual(["a1", "a2"]);
  });

  it("turns read-only on but never off", () => {
    expect(narrowAccess(access(), { readOnly: "true" }).readOnly).toBe(true);
    expect(narrowAccess(access({ readOnly: true }), { readOnly: "false" }).readOnly).toBe(true);
  });
});

describe("tokens limited to some apps", () => {
  it("don't get tools that need all apps, like create_app", () => {
    const base = { scopes: ["apps:write"], readOnly: false, groups: null, local: false };
    expect(isToolAllowed("create_app", "apps", { ...base, appIds: null })).toBe(true);
    expect(isToolAllowed("create_app", "apps", { ...base, appIds: ["app1"] })).toBe(false);
    expect(isToolAllowed("update_app_name", "apps", { ...base, appIds: ["app1"] })).toBe(true);
  });
});
