import { ToolContext, ToolServer } from "../../context.js";
import { z } from "zod";
import { SashidoClient } from "../../client/sashido.js";
import { deployGuard } from "../../advice/guard.js";

export function registerBuildTools(server: ToolServer, ctx: ToolContext): void {
  const getAuthFromRequest = (_args?: unknown, _extra?: unknown): string => ctx.token;
  // List Builds
  server.tool(
    "list_builds",
    "An app's builds of its cloud code repository and how each ended. Use it to see whether the last push built, and to get the buildId get_build_log takes.",
    {
      appObjectId: z.string().describe("The application object ID"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of builds to return (default: 30)"),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      const builds = await client.listBuilds(args.appObjectId, args.limit);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(builds, null, 2),
          },
        ],
      };
    },
  );

  // Build log
  server.tool(
    "get_build_log",
    "Get the log of a build, e.g. to find out why it failed. Returns the last lines, where errors show up, and whether the build is finished. Take buildId from list_builds.",
    {
      appObjectId: z.string().describe("The application object ID"),
      buildId: z.string().describe("The build's objectId, from list_builds"),
      lines: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("How many of the last lines to return (default 300)"),
    },
    async (args) => {
      const log = await ctx.sashido().getBuildLog(args.appObjectId, args.buildId, args.lines);
      const header = [
        `Build #${log.number ?? "?"} (${log.buildId}): ${log.phase ?? "unknown phase"}`,
        log.finished ? "finished" : "still running",
        log.truncated ? "showing the last lines only" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        content: [{ type: "text" as const, text: `${header}\n\n${log.text || "(empty log)"}` }],
      };
    },
  );

  // Trigger Build
  server.tool(
    "trigger_build",
    "Start a new build of an app's cloud code from its repository without a push, e.g. to retry a build that failed for a passing reason. A finished build is deployed, so it first checks that no class is open for everyone to write and delete, and starts nothing if one is. Check it with list_builds and get_build_log.",
    {
      appObjectId: z.string().describe("The application object ID"),
      region: z.string().optional().describe("Target region (optional)"),
      deployAnyway: z
        .boolean()
        .optional()
        .describe("Go on although the check before it found something critical. Only after the person, shown the finding, said to."),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      const guard = await deployGuard(ctx, args.appObjectId, "the build", args.deployAnyway);
      if (guard.stop) {
        return { content: [{ type: "text" as const, text: guard.stop }] };
      }
      await client.triggerBuild(args.appObjectId, args.region);

      return {
        content: [
          {
            type: "text" as const,
            text: `Build triggered successfully for app ${args.appObjectId}${guard.note ? `\n\n${guard.note}` : ""}`,
          },
        ],
      };
    },
  );

  // Cancel Build
  server.tool(
    "cancel_build",
    "Cancel a build that is running.",
    {
      appObjectId: z.string().describe("The application object ID"),
      buildName: z.string().describe("The name of the build to cancel"),
      region: z.string().optional().describe("Target region (optional)"),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      await client.cancelBuild(args.appObjectId, args.buildName, args.region);

      return {
        content: [
          {
            type: "text" as const,
            text: `Build ${args.buildName} cancelled successfully`,
          },
        ],
      };
    },
  );
}
