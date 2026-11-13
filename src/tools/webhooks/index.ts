import { ToolContext, ToolServer } from "../../context.js";
import { z } from "zod";
import {
  TriggerType,
  TriggerWebhook,
} from "../../client/parse.js";

// Trigger types for validation
const TRIGGER_TYPES = [
  "beforeSave",
  "afterSave",
  "beforeDelete",
  "afterDelete",
  "beforeFind",
  "afterFind",
] as const;

export function registerWebhookTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  const getClients = async (args: { appObjectId: string }, _extra?: unknown) => ({
    parseClient: ctx.parse(args.appObjectId),
    sashidoClient: ctx.sashido(),
    appName: await ctx.appName(args.appObjectId),
  });
  // =====================
  // FUNCTION WEBHOOKS
  // =====================

  // List Function Webhooks
  server.tool(
    "list_function_webhooks",
    "List all function webhooks registered on the Parse Server. Function webhooks allow external URLs to be called as cloud functions.",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const webhooks = await parseClient.listFunctionWebhooks();

        if (webhooks.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No function webhooks found.\n\nUse create_function_webhook to register an external URL as a cloud function.",
              },
            ],
          };
        }

        const output = [
          `🔗 Function Webhooks (${webhooks.length}):`,
          "",
          ...webhooks.map((wh) => `  • ${wh.functionName} → ${wh.url}`),
        ];

        return {
          content: [
            {
              type: "text" as const,
              text: output.join("\n"),
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
              text: `❌ Failed to list function webhooks: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Get Function Webhook
  server.tool(
    "get_function_webhook",
    "Get details of a specific function webhook by its function name",
    {
      appObjectId: z.string().describe("The application object ID"),
      functionName: z.string().describe("The function name of the webhook"),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const webhook = await parseClient.getFunctionWebhook(args.functionName);

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `🔗 Function Webhook: ${webhook.functionName}`,
                "",
                `URL: ${webhook.url}`,
              ].join("\n"),
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
              text: `❌ Failed to get function webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Create Function Webhook
  server.tool(
    "create_function_webhook",
    "Create a new function webhook that calls an external URL when the function is invoked. The URL must be accessible from the Parse Server.",
    {
      appObjectId: z.string().describe("The application object ID"),
      functionName: z
        .string()
        .describe(
          "The name for the cloud function (used when calling with Parse.Cloud.run)",
        ),
      url: z
        .string()
        .url()
        .describe("The external URL to call when the function is invoked"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        const webhook = await parseClient.createFunctionWebhook(
          args.functionName,
          args.url,
        );

        // Log activity
        await sashidoClient.logActivity(
          "create_function_webhook",
          `Created function webhook "${args.functionName}" for application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✅ Function webhook created successfully!`,
                "",
                `Function: ${webhook.functionName}`,
                `URL: ${webhook.url}`,
                "",
                `You can now call this function using Parse.Cloud.run("${webhook.functionName}", params)`,
              ].join("\n"),
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
              text: `❌ Failed to create function webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Update Function Webhook
  server.tool(
    "update_function_webhook",
    "Update the URL of an existing function webhook",
    {
      appObjectId: z.string().describe("The application object ID"),
      functionName: z
        .string()
        .describe("The function name of the webhook to update"),
      url: z.string().url().describe("The new external URL to call"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        const webhook = await parseClient.updateFunctionWebhook(
          args.functionName,
          args.url,
        );

        // Log activity
        await sashidoClient.logActivity(
          "update_function_webhook",
          `Updated function webhook "${args.functionName}" for application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✅ Function webhook updated successfully!`,
                "",
                `Function: ${webhook.functionName}`,
                `New URL: ${webhook.url}`,
              ].join("\n"),
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
              text: `❌ Failed to update function webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Delete Function Webhook
  server.tool(
    "delete_function_webhook",
    "Delete a function webhook",
    {
      appObjectId: z.string().describe("The application object ID"),
      functionName: z
        .string()
        .describe("The function name of the webhook to delete"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        await parseClient.deleteFunctionWebhook(args.functionName);

        // Log activity
        await sashidoClient.logActivity(
          "delete_function_webhook",
          `Deleted function webhook "${args.functionName}" for application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Function webhook "${args.functionName}" deleted successfully.`,
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
              text: `❌ Failed to delete function webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // =====================
  // TRIGGER WEBHOOKS
  // =====================

  // List Trigger Webhooks
  server.tool(
    "list_trigger_webhooks",
    "List all trigger webhooks registered on the Parse Server. Trigger webhooks allow external URLs to be called on class lifecycle events (beforeSave, afterSave, etc.).",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const webhooks = await parseClient.listTriggerWebhooks();

        if (webhooks.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  "No trigger webhooks found.",
                  "",
                  "Use create_trigger_webhook to register an external URL as a class trigger.",
                  "",
                  "Available trigger types: beforeSave, afterSave, beforeDelete, afterDelete, beforeFind, afterFind",
                ].join("\n"),
              },
            ],
          };
        }

        // Group by class for better readability
        const byClass: Record<string, TriggerWebhook[]> = {};
        for (const wh of webhooks) {
          const existing = byClass[wh.className];
          if (existing) {
            existing.push(wh);
          } else {
            byClass[wh.className] = [wh];
          }
        }

        const output = [`🔗 Trigger Webhooks (${webhooks.length}):`, ""];

        for (const [className, triggers] of Object.entries(byClass)) {
          output.push(`📦 ${className}:`);
          for (const trigger of triggers) {
            output.push(`   • ${trigger.triggerName} → ${trigger.url}`);
          }
          output.push("");
        }

        return {
          content: [
            {
              type: "text" as const,
              text: output.join("\n").trim(),
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
              text: `❌ Failed to list trigger webhooks: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Get Trigger Webhook
  server.tool(
    "get_trigger_webhook",
    "Get details of a specific trigger webhook",
    {
      appObjectId: z.string().describe("The application object ID"),
      className: z
        .string()
        .describe('The class name (e.g., "GameScore", "_User")'),
      triggerName: z
        .enum(TRIGGER_TYPES)
        .describe(
          "The trigger type: beforeSave, afterSave, beforeDelete, afterDelete, beforeFind, or afterFind",
        ),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const webhook = await parseClient.getTriggerWebhook(
          args.className,
          args.triggerName as TriggerType,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `🔗 Trigger Webhook`,
                "",
                `Class: ${webhook.className}`,
                `Trigger: ${webhook.triggerName}`,
                `URL: ${webhook.url}`,
              ].join("\n"),
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
              text: `❌ Failed to get trigger webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Create Trigger Webhook
  server.tool(
    "create_trigger_webhook",
    "Create a new trigger webhook that calls an external URL when a class lifecycle event occurs (e.g., beforeSave, afterDelete). The URL must be accessible from the Parse Server.",
    {
      appObjectId: z.string().describe("The application object ID"),
      className: z
        .string()
        .describe(
          'The class name to attach the trigger to (e.g., "GameScore", "_User")',
        ),
      triggerName: z
        .enum(TRIGGER_TYPES)
        .describe(
          "The trigger type: beforeSave, afterSave, beforeDelete, afterDelete, beforeFind, or afterFind",
        ),
      url: z
        .string()
        .url()
        .describe("The external URL to call when the trigger fires"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        const webhook = await parseClient.createTriggerWebhook(
          args.className,
          args.triggerName as TriggerType,
          args.url,
        );

        // Log activity
        await sashidoClient.logActivity(
          "create_trigger_webhook",
          `Created ${args.triggerName} trigger webhook for class "${args.className}" in application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✅ Trigger webhook created successfully!`,
                "",
                `Class: ${webhook.className}`,
                `Trigger: ${webhook.triggerName}`,
                `URL: ${webhook.url}`,
                "",
                `The webhook will be called every time a ${args.triggerName} event occurs on the ${args.className} class.`,
              ].join("\n"),
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
              text: `❌ Failed to create trigger webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Update Trigger Webhook
  server.tool(
    "update_trigger_webhook",
    "Update the URL of an existing trigger webhook",
    {
      appObjectId: z.string().describe("The application object ID"),
      className: z.string().describe("The class name"),
      triggerName: z
        .enum(TRIGGER_TYPES)
        .describe(
          "The trigger type: beforeSave, afterSave, beforeDelete, afterDelete, beforeFind, or afterFind",
        ),
      url: z.string().url().describe("The new external URL to call"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        const webhook = await parseClient.updateTriggerWebhook(
          args.className,
          args.triggerName as TriggerType,
          args.url,
        );

        // Log activity
        await sashidoClient.logActivity(
          "update_trigger_webhook",
          `Updated ${args.triggerName} trigger webhook for class "${args.className}" in application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✅ Trigger webhook updated successfully!`,
                "",
                `Class: ${webhook.className}`,
                `Trigger: ${webhook.triggerName}`,
                `New URL: ${webhook.url}`,
              ].join("\n"),
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
              text: `❌ Failed to update trigger webhook: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Delete Trigger Webhook
  server.tool(
    "delete_trigger_webhook",
    "Delete a trigger webhook",
    {
      appObjectId: z.string().describe("The application object ID"),
      className: z.string().describe("The class name"),
      triggerName: z
        .enum(TRIGGER_TYPES)
        .describe(
          "The trigger type: beforeSave, afterSave, beforeDelete, afterDelete, beforeFind, or afterFind",
        ),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        await parseClient.deleteTriggerWebhook(
          args.className,
          args.triggerName as TriggerType,
        );

        // Log activity
        await sashidoClient.logActivity(
          "delete_trigger_webhook",
          `Deleted ${args.triggerName} trigger webhook for class "${args.className}" in application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Trigger webhook "${args.triggerName}" for class "${args.className}" deleted successfully.`,
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
              text: `❌ Failed to delete trigger webhook: ${message}`,
            },
          ],
        };
      }
    },
  );
}
