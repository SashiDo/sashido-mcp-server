import { z } from "zod";
import { ToolContext, ToolServer } from "../../context.js";
import { PROCESS_METRICS_RANGES } from "../../client/metrics.js";
import { formatProcessMetrics } from "./format.js";

// How the processes of an app are doing: CPU, memory, event loop lag and
// restarts over time, what runs now, and what stands out. The API works the
// insights out; this passes them on with the tools that act on each.

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function registerMetricsTools(server: ToolServer, ctx: ToolContext): void {
  server.tool(
    "get_process_metrics",
    "How an app's processes (api, worker) are doing: CPU, memory, event loop lag and restarts over a period, what each engine uses right now against its limits, restart and deploy events, and what stands out (a memory leak, an engine at its memory or CPU limit, a blocked event loop, a process that keeps restarting) with what to do about it. Use it to find why an app is slow or restarting, or whether it needs a bigger engine or more engines.",
    {
      appObjectId: z.string().describe("The application object ID or its name"),
      range: z
        .enum(PROCESS_METRICS_RANGES)
        .optional()
        .describe("The period: 1h, 6h, 24h (default), 7d or 30d. Each engine by itself is told apart up to 24h."),
      series: z
        .boolean()
        .optional()
        .describe("Also list the numbers over time, a table per process (up to 24 rows each). Leave it out unless the trend itself is needed."),
    },
    async (args) => {
      const appObjectId = await ctx.resolveApp(args.appObjectId);
      const metrics = await ctx.sashido().getProcessMetrics(appObjectId, args.range || "24h");
      if (!metrics) {
        return text("Process metrics aren't available from the SashiDo API yet. check_app_health and get_app_infrastructure say what runs now.");
      }
      return text(
        formatProcessMetrics(metrics, {
          appName: await ctx.appName(appObjectId),
          series: args.series,
        }),
      );
    },
  );
}
