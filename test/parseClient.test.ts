import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ParseClient } from "../src/client/parse.js";
import { FakeApi, startFakeApi, token } from "./fakeApi.js";

// The paths and methods must match what the API's Parse proxy allows
// (sashido-api src/lib/parseProxy/rules.ts); the answers are what SashiDo's
// Parse Server routes send (SashiDo's Parse Server routes).

let api: FakeApi;
const TOKEN = token(1);
const P = "/apps/app1/parse";

beforeAll(async () => {
  api = await startFakeApi();
  api.tokens.set(TOKEN, { scopes: [], appIds: null });
});
afterAll(() => api.close());
beforeEach(() => {
  api.requests.length = 0;
  api.answers.clear();
});

const client = () => new ParseClient(TOKEN, "app1", api.url);
const last = () => api.requests[api.requests.length - 1]!;

describe("ParseClient through the proxy", () => {
  it("sends the token, never a master key", async () => {
    await client().listClasses();
    expect(last()).toMatchObject({ method: "GET", path: `${P}/schemas`, authorization: `Bearer ${TOKEN}` });
    expect(JSON.stringify(api.requests)).not.toMatch(/MasterKey|_ApplicationId/);
  });

  it("encodes path parts", async () => {
    await client().getObject("Post", "a/b");
    expect(last().path).toBe(`${P}/classes/Post/a%2Fb`);
  });

  it("creates a class at schemas/{className}", async () => {
    await client().createClass("Post", { title: { type: "String" } });
    expect(last()).toMatchObject({ method: "POST", path: `${P}/schemas/Post` });
  });

  it("uses plain methods for the job routes", async () => {
    api.answers.set(`GET ${P}/job`, { jobs: [{ objectId: "j1" }], showMore: false });
    const { jobs } = await client().listScheduledJobs(5);
    expect(last()).toMatchObject({ method: "GET", path: `${P}/job`, query: { limit: "5" } });
    expect(jobs).toHaveLength(1);

    await client().deleteJob("j1");
    expect(last()).toMatchObject({ method: "DELETE", path: `${P}/job`, query: { objectId: "j1" } });

    // the newest runs: the last ones inserted, sorted here (apps may mix
    // Date and string createdAt, which Mongo can't sort together)
    api.answers.set(`GET ${P}/classes/_JobStatus`, {
      count: 2,
      results: [
        { objectId: "s1", jobName: "cleanup", status: "succeeded", createdAt: "2017-10-23T19:45:30.399Z" },
        { objectId: "s2", jobName: "cleanup", status: "running", createdAt: new Date().toISOString() },
      ],
    });
    const runs = await client().getJobStatus(3);
    expect(runs.map((r) => r.objectId)).toEqual(["s2", "s1"]);
    const calls = api.requests.filter((r) => r.path === `${P}/classes/_JobStatus`).slice(-2);
    expect(calls[0]!.query).toMatchObject({ count: "1", limit: "0" });
    expect(calls[1]!.query).toMatchObject({ skip: "0", limit: "100" });

    // the proxy doesn't forward X-Parse-Job-Status-Id: the newest run of the job
    expect(await client().runJob("cleanup")).toEqual({ statusId: "s2" });
    expect(last()).toMatchObject({ path: `${P}/classes/_JobStatus`, query: { where: '{"jobName":"cleanup"}' } });

    api.answers.set(`GET ${P}/job/available`, { jobs: ["cleanup"], in_use: [] });
    expect(await client().listAvailableJobs()).toEqual({ jobs: ["cleanup"], inUse: [] });
  });

  it("reads push audiences as the routes send them", async () => {
    api.answers.set(`GET ${P}/push_audience`, { audiences: [{ objectId: "a1", name: "VIP" }], showMore: false });
    const { audiences } = await client().listAudiences();
    expect(audiences[0]!.name).toBe("VIP");

    api.answers.set(`PUT ${P}/push_audience`, { success: true, new_audience: { objectId: "a2" } });
    expect(await client().createAudience("New", {})).toEqual({ success: true, objectId: "a2" });

    api.answers.set(`DELETE ${P}/push_audience`, { success: true });
    expect(await client().deleteAudience("a2")).toEqual({ success: true });
    expect(last().query).toEqual({ objectId: "a2" });

    api.answers.set(`GET ${P}/available_devices`, { available_devices: ["ios"] });
    expect(await client().listAvailableDevices()).toEqual(["ios"]);
  });

  it("reads cloud code files", async () => {
    await client().listCloudCodeFiles();
    expect(last()).toMatchObject({ method: "GET", path: `${P}/releases/latest` });

    // the route's { response: content } arrives as a JSON string
    api.answers.set(`GET ${P}/scripts/main.js`, "Parse.Cloud.define('hi', () => 'hi');\n");
    const content = await client().readCloudCodeFile("cloud/main.js");
    expect(last().path).toBe(`${P}/scripts/main.js`);
    expect(content).toBe("Parse.Cloud.define('hi', () => 'hi');\n");
  });

  it("reads logs with level and n", async () => {
    api.answers.set(`GET ${P}/scriptlog`, []);
    await client().getLogs({ level: "error", limit: 20 });
    expect(last()).toMatchObject({ method: "GET", path: `${P}/scriptlog`, query: { level: "error", n: "20" } });
  });
});
