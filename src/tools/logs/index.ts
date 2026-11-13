import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';

export function registerLogTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // Get Cloud Code Logs
  server.tool(
    'get_logs',
    'Get cloud code logs (console.log, console.error, etc.) from the Parse Server. Useful for debugging cloud functions.',
    {
      appObjectId: z.string().describe('The application object ID'),
      level: z
        .enum(['info', 'error', 'warn', 'debug'])
        .optional()
        .describe('Log level to filter by (default: info)'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of log entries to return (default: 100, max: 1000)'),
    },
    async (args) => {
      try {
        const parseClient = await getParseClient(args);
        const logs = await parseClient.getLogs({
          level: args.level,
          limit: Math.min(args.limit || 100, 1000),
        });

        if (!logs || logs.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `📋 No ${args.level || 'info'} logs found.\n\nLogs appear when your cloud code uses console.log(), console.error(), etc.`,
              },
            ],
          };
        }

        const levelEmoji: Record<string, string> = {
          info: 'ℹ️',
          error: '❌',
          warn: '⚠️',
          debug: '🔍',
        };

        const output = [
          `📋 Cloud Code Logs (${logs.length} entries, level: ${args.level || 'info'})`,
          '',
        ];

        for (const log of logs) {
          const emoji = levelEmoji[log.level] || '📝';
          const time = log.timestamp ? new Date(log.timestamp).toISOString() : 'unknown';
          output.push(`${emoji} [${time}] ${log.message}`);

          // If there's additional data, show it
          const extraKeys = Object.keys(log).filter(k => !['timestamp', 'level', 'message'].includes(k));
          if (extraKeys.length > 0) {
            const extra: Record<string, unknown> = {};
            for (const key of extraKeys) {
              extra[key] = log[key];
            }
            output.push(`   ${JSON.stringify(extra)}`);
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Failed to get logs: ${message}`,
            },
          ],
        };
      }
    }
  );

  // Get Error Logs (convenience shortcut)
  server.tool(
    'get_error_logs',
    'Get error logs from cloud code (shortcut for get_logs with level=error)',
    {
      appObjectId: z.string().describe('The application object ID'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of log entries to return (default: 50)'),
    },
    async (args) => {
      try {
        const parseClient = await getParseClient(args);
        const logs = await parseClient.getLogs({
          level: 'error',
          limit: Math.min(args.limit || 50, 1000),
        });

        if (!logs || logs.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `✅ No error logs found! Your cloud code is running without errors.`,
              },
            ],
          };
        }

        const output = [
          `🔴 Error logs (${logs.length} entries)`,
          '',
        ];

        for (const log of logs) {
          const time = log.timestamp ? new Date(log.timestamp).toISOString() : 'unknown';
          output.push(`[${time}]`);
          output.push(`  ${log.message}`);
          output.push('');
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Failed to get error logs: ${message}`,
            },
          ],
        };
      }
    }
  );
}
