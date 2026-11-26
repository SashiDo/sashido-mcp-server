import { ToolContext, ToolServer } from "../../context.js";
import { z } from "zod";
import { SashidoClient } from "../../client/sashido.js";

export function registerAppTools(server: ToolServer, ctx: ToolContext): void {
  const getAuthFromRequest = (_args?: unknown, _extra?: unknown): string => ctx.token;
  // List Apps
  server.tool(
    "list_apps",
    "The SashiDo apps this token can reach, each with its objectId and name. Start here: the other tools take an app's objectId.",
    {
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);
      const apps = await client.listApps();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(apps, null, 2),
          },
        ],
      };
    },
  );

  // Get App (by objectId from list_apps)
  server.tool(
    "get_app",
    "One app's details, with what a client app needs to connect to it through the Parse SDK: the app ID, the client, JavaScript and .NET keys and the API URL (serverUrl; publicServerUrl when the app has its own domain). These are public: every client app is shipped with them. The master key and every other secret are never given to an access token, for the person's security. Use it to wire a web or mobile app to its backend.",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      // Get all apps and find the one with matching objectId
      const apps = await client.listApps();
      const app = apps.find((a) => a.objectId === args.appObjectId);

      if (!app) {
        return {
          content: [
            {
              type: "text" as const,
              text: `App with objectId ${args.appObjectId} not found`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(app, null, 2),
          },
        ],
      };
    },
  );

  // Create App
  server.tool(
    "create_app",
    "Create a new SashiDo app: a managed Parse Server backend with its own MongoDB database, user accounts and login, file storage, push notifications, Live Queries, cloud code and background jobs. Use it when the app being built needs a backend (accounts, shared data, realtime, push, server-side logic) and has none yet. Next: create_class to design the data, update_class_permissions to lock it down, generate_types for the client, get_app for the app ID, the client key and the API URL. A new app counts toward the account's plan.",
    {
      name: z.string().describe("Application name"),
      region: z
        .string()
        .describe(
          'Region: "eu" (Europe, 1-eu), "us" (North America, 2-us), "jp" (Japan, 1-jp) or "au" (Australia, 1-au)',
        ),
      parseServerVersion: z
        .string()
        .optional()
        .describe(
          "The version's imageTag from list_parse_server_versions; default: the one marked as default for new apps",
        ),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      // Region mapping: short code -> full format expected by API
      const regionMap: Record<string, string> = {
        eu: "1-eu",
        us: "2-us",
        jp: "1-jp",
        au: "1-au",
      };

      // Normalize region: "eu" -> "1-eu", "1-eu" -> "1-eu"
      let region = args.region;
      const shortCode = region.toLowerCase();
      if (regionMap[shortCode]) {
        region = regionMap[shortCode];
      }

      // Validate region format
      const validRegions = Object.values(regionMap);
      if (!validRegions.includes(region)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid region "${args.region}". Valid regions are: ${Object.keys(regionMap).join(", ")} (or ${validRegions.join(", ")})`,
            },
          ],
        };
      }

      try {
        const app = await client.createApp({
          name: args.name,
          region,
          parseServerVersion: args.parseServerVersion,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ App created successfully!\n\n${JSON.stringify(app, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Failed to create app: ${message}\n\nRequest details:\n- Name: ${args.name}\n- Region: ${region}\n- Parse Server Version: ${args.parseServerVersion || "default"}`,
            },
          ],
        };
      }
    },
  );
}
