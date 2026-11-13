import { ToolContext, ToolServer } from "../../context.js";
import { z } from "zod";

export function registerJobTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  const getClients = async (args: { appObjectId: string }, _extra?: unknown) => ({
    parseClient: ctx.parse(args.appObjectId),
    sashidoClient: ctx.sashido(),
    appName: await ctx.appName(args.appObjectId),
  });
  // List Available Jobs (defined in cloud code)
  server.tool(
    "list_available_jobs",
    "List all background jobs defined in cloud code that can be scheduled",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const result = await parseClient.listAvailableJobs();

        if (result.jobs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No background jobs defined in cloud code.\n\nTo define a job, use Parse.Cloud.job() in your cloud code.",
              },
            ],
          };
        }

        const output = [
          `📋 Available Jobs (${result.jobs.length}):`,
          "",
          ...result.jobs.map((job) => {
            const inUse = result.inUse.includes(job) ? " (scheduled)" : "";
            return `  • ${job}${inUse}`;
          }),
        ];

        if (result.inUse.length > 0) {
          output.push("", `Currently scheduled: ${result.inUse.length} job(s)`);
        }

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
              text: `❌ Failed to list available jobs: ${message}`,
            },
          ],
        };
      }
    },
  );

  // List Scheduled Jobs
  server.tool(
    "list_scheduled_jobs",
    "List all scheduled background jobs for the application",
    {
      appObjectId: z.string().describe("The application object ID"),
      limit: z.number().optional().describe("Maximum number of jobs to return"),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const result = await parseClient.listScheduledJobs(args.limit);

        if (result.jobs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No scheduled jobs found.\n\nUse schedule_job to create a new scheduled job.",
              },
            ],
          };
        }

        const output = [`📅 Scheduled Jobs (${result.jobs.length}):`, ""];

        for (const job of result.jobs) {
          output.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          output.push(`📌 ${job.name}`);
          output.push(`   ID: ${job.objectId}`);
          if (job.description)
            output.push(`   Description: ${job.description}`);
          if (job.nextRunAt) output.push(`   Next Run: ${job.nextRunAt}`);
          if (job.lastRunAt) output.push(`   Last Run: ${job.lastRunAt}`);
          if (job.repeatInterval)
            output.push(`   Repeat: ${job.repeatInterval}`);
          if (job.type) output.push(`   Type: ${job.type}`);
          if (job.failCount && job.failCount > 0) {
            output.push(`   ⚠️ Failures: ${job.failCount}`);
            if (job.failReason) output.push(`   Last Error: ${job.failReason}`);
          }
        }

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
              text: `❌ Failed to list scheduled jobs: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Get Job Execution Status/History
  server.tool(
    "get_job_status",
    "Get the execution history and status of background jobs",
    {
      appObjectId: z.string().describe("The application object ID"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of status entries to return (default: 30)"),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(
          args,
          extra,
        );
        const statuses = await parseClient.getJobStatus(args.limit);

        if (statuses.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No job execution history found.",
              },
            ],
          };
        }

        const output = [`📊 Job Execution History (${statuses.length}):`, ""];

        for (const status of statuses) {
          const emoji =
            status.status === "succeeded"
              ? "✅"
              : status.status === "failed"
                ? "❌"
                : status.status === "running"
                  ? "🔄"
                  : "⏳";
          output.push(
            `${emoji} ${status.jobName} - ${status.status.toUpperCase()}`,
          );
          output.push(`   ID: ${status.objectId}`);
          output.push(`   Started: ${status.createdAt}`);
          if (status.finishedAt)
            output.push(`   Finished: ${status.finishedAt}`);
          if (status.message) output.push(`   Message: ${status.message}`);
          output.push("");
        }

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
              text: `❌ Failed to get job status: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Schedule a Job
  server.tool(
    "schedule_job",
    "Schedule a background job to run at a specific time, optionally repeating",
    {
      appObjectId: z.string().describe("The application object ID"),
      jobName: z
        .string()
        .describe("Name of the job (must be defined in cloud code)"),
      startAfter: z
        .string()
        .describe(
          "ISO 8601 date string when the job should first run (must be at least 5 minutes in the future)",
        ),
      repeatMinutes: z
        .number()
        .optional()
        .describe("Repeat interval in minutes (optional)"),
      description: z
        .string()
        .optional()
        .describe("Description of this scheduled job"),
      params: z
        .record(z.unknown())
        .optional()
        .describe("Parameters to pass to the job"),
      objectId: z
        .string()
        .optional()
        .describe("Object ID of existing job to update (optional)"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );

        // Validate start time is at least 5 minutes in the future
        const startTime = new Date(args.startAfter);
        const minStartTime = new Date(Date.now() + 5 * 60 * 1000);

        if (startTime < minStartTime) {
          return {
            content: [
              {
                type: "text" as const,
                text: `⚠️ The job must be scheduled at least 5 minutes in the future.\n\nEarliest allowed time: ${minStartTime.toISOString()}`,
              },
            ],
          };
        }

        const result = await parseClient.scheduleJob({
          jobName: args.jobName,
          startAfter: args.startAfter,
          repeatMinutes: args.repeatMinutes,
          description: args.description,
          params: args.params as Record<string, unknown>,
          objectId: args.objectId,
        });

        // Log activity
        await sashidoClient.logActivity(
          "create_job",
          `Successfully created Job (${args.jobName}) for application ${appName}`,
        );

        const repeatInfo = args.repeatMinutes
          ? `\nRepeat: Every ${args.repeatMinutes} minutes`
          : "\nRepeat: One-time execution";

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✅ Job scheduled successfully!`,
                "",
                `Job: ${args.jobName}`,
                `ID: ${result.objectId}`,
                `First Run: ${args.startAfter}`,
                repeatInfo,
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
              text: `❌ Failed to schedule job: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Run Job Immediately
  server.tool(
    "run_job",
    "Run a background job immediately (one-time execution)",
    {
      appObjectId: z.string().describe("The application object ID"),
      jobName: z
        .string()
        .describe("Name of the job to run (must be defined in cloud code)"),
      params: z
        .record(z.unknown())
        .optional()
        .describe("Parameters to pass to the job"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        const result = await parseClient.runJob(
          args.jobName,
          args.params as Record<string, unknown>,
        );

        // Log activity
        await sashidoClient.logActivity(
          "run_job",
          `Successfully ran Job (${args.jobName}) for application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `🚀 Job started!`,
                "",
                `Job: ${args.jobName}`,
                `Status ID: ${result.statusId}`,
                "",
                `Use get_job_status to check the execution result.`,
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
              text: `❌ Failed to run job: ${message}`,
            },
          ],
        };
      }
    },
  );

  // Delete Scheduled Job
  server.tool(
    "delete_job",
    "Delete a scheduled background job",
    {
      appObjectId: z.string().describe("The application object ID"),
      objectId: z
        .string()
        .describe("The object ID of the scheduled job to delete"),
    },
    async (args, extra) => {
      try {
        const { parseClient, sashidoClient, appName } = await getClients(
          args,
          extra,
        );
        await parseClient.deleteJob(args.objectId);

        // Log activity
        await sashidoClient.logActivity(
          "delete_job",
          `Successfully deleted Job (${args.objectId}) for application ${appName}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Scheduled job deleted successfully.\n\nJob ID: ${args.objectId}`,
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
              text: `❌ Failed to delete job: ${message}`,
            },
          ],
        };
      }
    },
  );
}
