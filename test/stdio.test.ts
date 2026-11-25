import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_POLICY } from "../src/access.js";
import { NO_TOKEN, createStdioServer } from "../src/transports/stdio.js";

// A client talking to the local server, without a process in between
async function connect(options: Parameters<typeof createStdioServer>[0]) {
  const { server, tools } = await createStdioServer(options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, tools };
}

describe("the local server without an access token", () => {
  it("starts and lists every tool, so a catalog can see what it does", async () => {
    const { client, tools } = await connect({});

    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(listed).toEqual(Object.keys(TOOL_POLICY).sort());
    expect(tools.sort()).toEqual(listed);
    expect(client.getInstructions()).toContain("SashiDo");
  });

  it("runs none of them: each call says how to get a token", async () => {
    const { client } = await connect({});

    for (const name of ["list_apps", "delete_object", "set_engine"]) {
      const result = (await client.callTool({
        name,
        arguments: { appObjectId: "app1", className: "Todo", objectId: "x", engineName: "small", billingPolicy: "hourly", confirmBillingChange: true, confirmDelete: true },
      })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe(NO_TOKEN);
    }
  });

  it("still follows what narrows a connection", async () => {
    const readOnly = await connect({ readOnly: "true" });
    const names = (await readOnly.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_apps");
    expect(names).not.toContain("delete_object");

    const logsOnly = await connect({ features: "logs" });
    expect((await logsOnly.client.listTools()).tools.map((t) => t.name).sort()).toEqual(["get_error_logs", "get_logs"]);
  });

  it("refuses to start with a token that isn't one", async () => {
    await expect(createStdioServer({ token: "not-a-token" })).rejects.toThrow(/SASHIDO_ACCESS_TOKEN/);
  });
});
