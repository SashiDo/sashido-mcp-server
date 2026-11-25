import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';

export function registerHealthTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // Check App Health
  server.tool(
    'check_app_health',
    "Whether an app's Parse Server answers right now. Use it after a deployment or when clients report errors. For how it has been doing over time, and why, use get_process_metrics.",
    {
      appObjectId: z.string().describe('The application object ID'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        const health = await parseClient.checkHealth();

        const statusEmoji = health.status === 'ok' ? '✅' : '⚠️';
        const dbEmoji = health.database === 'ok' ? '✅' : '❌';

        const output = [
          `${statusEmoji} Status: ${health.status?.toString().toUpperCase() || 'UNKNOWN'}`,
          `${dbEmoji} Database: ${health.database || 'unknown'}`,
          ``,
          `Parse Server: v${health.version || 'unknown'}`,
          `Node.js: ${health.nodeVersion || 'unknown'}`,
          `Region: ${health.region || 'unknown'}`,
          ``,
          `Build: #${health.build || 'N/A'}`,
          `Deployment: #${health.deployment || 'N/A'}`,
          `State: ${health.state || 'unknown'}`,
        ].join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: output,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Health check failed: ${message}\n\nThe app may be down, not deployed, or unreachable.`,
            },
          ],
        };
      }
    }
  );
}
