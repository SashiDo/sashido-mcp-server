import { z } from "zod";
import { ToolContext, ToolServer } from "../../context.js";
import { Activity } from "../../client/sashido.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function describeActor(a: Activity): string {
  const actor = a.actor;
  if (!actor) {
    return "";
  }
  if (actor.kind === "access_token") {
    return `token "${actor.tokenName || actor.tokenId}"`;
  }
  return actor.kind === "platform" ? "SashiDo" : "dashboard session";
}

function describeVia(a: Activity): string {
  const via = a.via;
  if (!via || !via.client) {
    return "";
  }
  const details = [via.mcpClient, via.mcpTool ? `tool ${via.mcpTool}` : ""].filter(Boolean).join(", ");
  return `via ${via.client}${details ? ` (${details})` : ""}`;
}

/** One line: when, what, app, result, who, through what, message */
export function describeActivity(a: Activity, appName: string | null): string {
  const result = a.result
    ? a.result.status === "ok"
      ? "ok"
      : `${a.result.status}${a.result.code ? ` ${a.result.code}` : ""}${a.result.message ? `: ${a.result.message}` : ""}`
    : "";
  const params = (a.data && a.data.params) || {};
  const count = a.type === "data_read_summary" ? `${params["count"]} reads of ${params["className"]}` : "";
  return [
    a.createdAt.replace("T", " ").slice(0, 19),
    a.type,
    appName,
    result,
    describeActor(a),
    describeVia(a),
    count,
    a.source === "client" ? "(reported by the client)" : "",
    a.data && a.data.message ? `- ${a.data.message}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

export function registerAuditTools(server: ToolServer, ctx: ToolContext): void {
  server.tool(
    "get_audit_log",
    "The account's activity, newest first: who did what, to which app, through what (dashboard, API token, this MCP server and its tool), and how it ended. Use it to find out what happened, e.g. who changed an app or what an AI client did.",
    {
      type: z
        .string()
        .optional()
        .describe("Only this kind, e.g. deploy, set_env, set_engine, parse_proxy_write, read_users, access_refused"),
      app: z.string().optional().describe("Only this app: its name or objectId"),
      page: z.number().int().min(1).optional().describe("Page of 50 (default 1)"),
    },
    async (args) => {
      const appId = args.app ? await ctx.resolveApp(args.app) : null;
      const activities = await ctx.sashido().listActivities({ type: args.type, page: args.page });
      const shown = appId ? activities.filter((a) => a.app && a.app.objectId === appId) : activities;
      if (!shown.length) {
        return text(`No activity${args.type ? ` of type ${args.type}` : ""}${args.app ? ` for ${args.app}` : ""} on this page.`);
      }
      const lines = await Promise.all(
        shown.map(async (a) => describeActivity(a, a.app ? await ctx.appName(a.app.objectId) : null)),
      );
      return text(
        [
          `Activity, newest first (page ${args.page || 1}${appId ? `, filtered from ${activities.length}` : ""}):`,
          ...lines,
          activities.length === 50 ? `\nMore: page ${(args.page || 1) + 1}.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );
}
