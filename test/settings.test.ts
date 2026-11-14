import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { ErrorAnswer, FakeApi, startFakeApi, token } from "./fakeApi.js";

let api: FakeApi;
let server: Server;
let base: string;

const SETTINGS = token(11);
const READER = token(12);
const NONE = token(13);

const VIEW = {
  users: { usernameAndPassword: true, mfaTotp: false },
  socialLogin: { github: { enabled: true, clientId: "gh-id", clientSecretSet: true, acceptAccessToken: true } },
  email: { verifyUserEmails: false, senderAddress: null, senderDisplayName: null },
  customPages: {},
  push: { clientPush: false, restPush: false, advancedDiagnostics: false },
  liveQueries: { classes: [] },
  api: {},
  availability: { mfaTotp: null },
};

beforeAll(async () => {
  api = await startFakeApi();
  process.env["SASHIDO_API_URL"] = api.url;
  process.env["SASHIDO_POLL_MS"] = "20";
  api.tokens.set(SETTINGS, {
    scopes: ["account:read", "apps:read", "settings:read", "settings:write"],
    appIds: null,
  });
  api.tokens.set(READER, { scopes: ["account:read", "settings:read"], appIds: null });
  api.tokens.set(NONE, { scopes: ["account:read", "apps:read", "apps:write"], appIds: null });
  api.answers.set("GET /users/info", {
    data: { user: {}, products: { apps: [{ objectId: "app1", name: "Shop" }] } },
  });
  api.answers.set("GET /processes/app1/latest-deployment", {
    "parse-server-deployment-7-abcde": [{ cpu: 1 }],
  });
  api.answers.set("GET /apps/app1/deployments", { data: [] });

  const { createHttpApp } = await import("../src/transports/http.js");
  server = await new Promise((resolve) => {
    const s = createHttpApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await api.close();
});

const rpc = async (method: string, params: unknown, auth: string) => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
};

const toolNames = async (auth: string) =>
  ((await rpc("tools/list", {}, auth)).result.tools as Array<{ name: string }>).map((t) => t.name);

const call = async (name: string, args: Record<string, unknown>, auth = SETTINGS) =>
  (await rpc("tools/call", { name, arguments: args }, auth)).result as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };

const lastRequest = (method: string, path: string) =>
  [...api.requests].reverse().find((r) => r.method === method && r.path === path);

describe("settings tools per scope", () => {
  it("shows them to tokens with the settings scopes only", async () => {
    const all = await toolNames(SETTINGS);
    expect(all).toEqual(expect.arrayContaining([
      "get_app_settings", "update_app_settings", "get_custom_domain", "set_custom_domain", "remove_custom_domain",
    ]));
    const reader = await toolNames(READER);
    expect(reader).toContain("get_app_settings");
    expect(reader).toContain("get_custom_domain");
    expect(reader).not.toContain("update_app_settings");
    expect(reader).not.toContain("set_custom_domain");
    const none = await toolNames(NONE);
    expect(none.filter((n) => /settings|domain/.test(n))).toEqual([]);
  });
});

describe("app settings", () => {
  it("reads the settings by the app's name", async () => {
    api.answers.set("GET /apps/app1/settings", { data: VIEW });
    const result = await call("get_app_settings", { appObjectId: "Shop" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('"clientSecretSet": true');
  });

  it("sends only the sections given, and tells how to wait for the rollout", async () => {
    api.answers.set("PATCH /apps/app1/settings", { data: { settings: VIEW, redeploys: true } });
    const result = await call("update_app_settings", {
      appObjectId: "app1",
      users: { mfaTotp: true },
      socialLogin: { github: { clientId: "new", clientSecret: "s3cret" } },
    });
    expect(lastRequest("PATCH", "/apps/app1/settings")!.body).toEqual({
      users: { mfaTotp: true },
      socialLogin: { github: { clientId: "new", clientSecret: "s3cret" } },
    });
    const text = result.content[0]!.text;
    expect(text).toMatch(/call wait_for_deployment with after: 7/);
    // what the tool answers comes from the API, which never sends secrets
    expect(text).not.toContain("s3cret");
  });

  it("says when nothing redeploys", async () => {
    api.answers.set("PATCH /apps/app1/settings", { data: { settings: VIEW, redeploys: false } });
    const result = await call("update_app_settings", { appObjectId: "app1", push: { clientPush: true } });
    expect(result.content[0]!.text).toMatch(/doesn't need to redeploy/);
  });

  it("refuses an empty change without calling the API", async () => {
    const before = api.requests.length;
    const result = await call("update_app_settings", { appObjectId: "app1" });
    expect(result.isError).toBe(true);
    expect(api.requests.slice(before).some((r) => r.method === "PATCH")).toBe(false);
  });

  it("passes the API's refusal on", async () => {
    api.answers.set(
      "PATCH /apps/app1/settings",
      new ErrorAnswer(400, { code: 311, message: "This setting needs Parse Server 8.6.104 or newer." }),
    );
    const result = await call("update_app_settings", { appObjectId: "app1", users: { mfaTotp: true } });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("8.6.104");
  });
});

describe("custom domain", () => {
  const TARGET = "pg-app-shop.scalabl.cloud";

  it("tells what CNAME to create when there is no domain", async () => {
    api.answers.set("GET /apps/app1/domain", {
      data: { hostName: null, letsEncrypt: false, dns: { target: TARGET, records: [] } },
    });
    const text = (await call("get_custom_domain", { appObjectId: "app1" })).content[0]!.text;
    expect(text).toContain(`CNAME record from the host name to ${TARGET}`);
  });

  it("sets a domain with Let's Encrypt", async () => {
    api.answers.set("PUT /apps/app1/domain", {
      data: {
        hostName: "api.example.com",
        letsEncrypt: true,
        dns: { target: TARGET, records: [`api.example.com CNAME ${TARGET}`] },
        redeploys: true,
      },
    });
    const result = await call("set_custom_domain", {
      appObjectId: "app1",
      hostName: "api.example.com",
      letsEncrypt: true,
    });
    expect(lastRequest("PUT", "/apps/app1/domain")!.body).toEqual({ hostName: "api.example.com", letsEncrypt: true });
    expect(result.content[0]!.text).toMatch(/api\.example\.com \(Let's Encrypt certificate: on\)/);
    expect(result.content[0]!.text).toMatch(/wait_for_deployment with after: 7/);
  });

  it("passes the CNAME refusal on", async () => {
    api.answers.set(
      "PUT /apps/app1/domain",
      new ErrorAnswer(400, { code: 311, message: `Hostname api.example.com have to point to ${TARGET} with a CNAME record.` }),
    );
    const result = await call("set_custom_domain", { appObjectId: "app1", hostName: "api.example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(TARGET);
  });

  it("removes the domain", async () => {
    api.answers.set("DELETE /apps/app1/domain", {
      data: { hostName: null, letsEncrypt: false, dns: { target: TARGET, records: [] }, redeploys: true },
    });
    const result = await call("remove_custom_domain", { appObjectId: "app1" });
    expect(lastRequest("DELETE", "/apps/app1/domain")).toBeTruthy();
    expect(result.content[0]!.text).toMatch(/Custom domain removed/);
  });
});
