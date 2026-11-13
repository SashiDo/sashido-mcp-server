import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';

export function registerPushTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // Send Push Notification
  server.tool(
    'send_push',
    'Send a push notification to devices',
    {
      appObjectId: z.string().describe('The application object ID'),
      alert: z.string().describe('The notification message text'),
      channels: z
        .string()
        .optional()
        .describe('Comma-separated list of channels to send to (e.g., "news,sports")'),
      where: z
        .string()
        .optional()
        .describe('JSON string of query constraints for targeting specific installations'),
      badge: z
        .string()
        .optional()
        .describe('Badge number or "Increment" to increase by 1'),
      sound: z.string().optional().describe('Sound file name to play'),
      title: z.string().optional().describe('Notification title (Android)'),
      data: z
        .string()
        .optional()
        .describe('JSON string of additional custom data to include'),
      pushTime: z
        .string()
        .optional()
        .describe('ISO 8601 date/time to schedule the push (e.g., "2024-12-25T10:00:00Z")'),
      expirationTime: z
        .string()
        .optional()
        .describe('ISO 8601 date/time when the message expires'),
      expirationInterval: z
        .number()
        .optional()
        .describe('Number of seconds from now until the message expires'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);

      // Build push data
      const pushData: {
        alert?: string;
        badge?: number | string;
        sound?: string;
        title?: string;
        [key: string]: unknown;
      } = {
        alert: args.alert,
      };

      if (args.badge) {
        pushData.badge = args.badge === 'Increment' ? 'Increment' : parseInt(args.badge, 10);
      }
      if (args.sound) pushData.sound = args.sound;
      if (args.title) pushData.title = args.title;

      // Merge custom data
      if (args.data) {
        try {
          const customData = JSON.parse(args.data);
          Object.assign(pushData, customData);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Invalid JSON in "data" parameter',
              },
            ],
          };
        }
      }

      // Build push request
      const pushRequest: {
        where?: Record<string, unknown>;
        channels?: string[];
        data: typeof pushData;
        push_time?: string;
        expiration_time?: string;
        expiration_interval?: number;
      } = {
        data: pushData,
      };

      // Either channels or where must be specified
      if (args.channels) {
        pushRequest.channels = args.channels.split(',').map(c => c.trim());
      } else if (args.where) {
        try {
          pushRequest.where = JSON.parse(args.where);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Invalid JSON in "where" parameter',
              },
            ],
          };
        }
      } else {
        // Default to all installations if no targeting specified
        pushRequest.where = {};
      }

      if (args.pushTime) pushRequest.push_time = args.pushTime;
      if (args.expirationTime) pushRequest.expiration_time = args.expirationTime;
      if (args.expirationInterval) pushRequest.expiration_interval = args.expirationInterval;

      try {
        const result = await parseClient.sendPush(pushRequest);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Push notification sent successfully.\n\nResult: ${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error sending push notification: ${message}`,
            },
          ],
        };
      }
    }
  );

  // Send Push to Channels (simplified version)
  server.tool(
    'send_push_to_channels',
    'Send a simple push notification to specific channels',
    {
      appObjectId: z.string().describe('The application object ID'),
      channels: z.string().describe('Comma-separated list of channels (e.g., "news,sports,updates")'),
      alert: z.string().describe('The notification message text'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);

      const channelList = args.channels.split(',').map(c => c.trim());

      try {
        const result = await parseClient.sendPush({
          channels: channelList,
          data: {
            alert: args.alert,
          },
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Push notification sent to channels [${channelList.join(', ')}].\n\nResult: ${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error sending push notification: ${message}`,
            },
          ],
        };
      }
    }
  );

  // === PUSH AUDIENCES ===

  // List Audiences
  server.tool(
    'list_audiences',
    'List all push notification audiences (saved queries for targeting users)',
    {
      appObjectId: z.string().describe('The application object ID'),
      limit: z.number().optional().describe('Maximum number of audiences to return (default: 100)'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        const result = await parseClient.listAudiences(args.limit);

        if (result.audiences.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No push audiences found.\n\nUse create_audience to create a new audience for targeting push notifications.',
              },
            ],
          };
        }

        const output = [
          `👥 Push Audiences (${result.audiences.length}):`,
          '',
        ];

        for (const audience of result.audiences) {
          output.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          output.push(`📌 ${audience.name}`);
          output.push(`   ID: ${audience.objectId}`);
          output.push(`   Query: ${JSON.stringify(audience.query)}`);
          output.push(`   Times Used: ${audience.timesUsed}`);
          if (audience.lastUsed) output.push(`   Last Used: ${audience.lastUsed}`);
          output.push(`   Created: ${audience.createdAt}`);
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
              text: `❌ Failed to list audiences: ${message}`,
            },
          ],
        };
      }
    }
  );

  // Create Audience
  server.tool(
    'create_audience',
    'Create a new push notification audience (saved query for targeting users)',
    {
      appObjectId: z.string().describe('The application object ID'),
      name: z.string().describe('Name for the audience (e.g., "iOS Users", "Premium Members")'),
      query: z.string().describe('JSON query for targeting installations (e.g., {"deviceType": "ios"})'),
    },
    async (args, extra) => {
      try {
        let queryObj: Record<string, unknown>;
        try {
          queryObj = JSON.parse(args.query);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Invalid JSON in query parameter.\n\nExample: {"deviceType": "ios"} or {"channels": {"$in": ["news"]}}',
              },
            ],
          };
        }

        const parseClient = await getParseClient(args, extra);
        const result = await parseClient.createAudience(args.name, queryObj);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `✅ Audience created successfully!`,
                '',
                `Name: ${args.name}`,
                `ID: ${result.objectId}`,
                `Query: ${args.query}`,
                '',
                `You can now use this audience when sending push notifications.`,
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Failed to create audience: ${message}`,
            },
          ],
        };
      }
    }
  );

  // Delete Audience
  server.tool(
    'delete_audience',
    'Delete a push notification audience',
    {
      appObjectId: z.string().describe('The application object ID'),
      audienceId: z.string().describe('The object ID of the audience to delete'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        // the app server answers success for any id: check it exists first
        const { audiences } = await parseClient.listAudiences(1000);
        const audience = audiences.find((a) => a.objectId === args.audienceId);
        if (!audience) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ No audience ${args.audienceId}. Existing: ${audiences.map((a) => `${a.name} (${a.objectId})`).join(', ') || 'none'}.`,
              },
            ],
          };
        }
        await parseClient.deleteAudience(args.audienceId);

        return {
          content: [
            {
              type: 'text' as const,
              text: `✅ Audience "${audience.name}" deleted.\n\nAudience ID: ${args.audienceId}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Failed to delete audience: ${message}`,
            },
          ],
        };
      }
    }
  );

  // Get Push Status
  server.tool(
    'get_push_status',
    'Get the status and delivery statistics of push notifications. Can retrieve a specific push by ID or list recent pushes.',
    {
      appObjectId: z.string().describe('The application object ID'),
      pushStatusId: z
        .string()
        .optional()
        .describe('The objectId of a specific push notification to get status for'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of push statuses to return (default: 10, ignored if pushStatusId is provided)'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        const queryOptions: {
          where?: Record<string, unknown>;
          limit?: number;
          order?: string;
        } = { order: '-createdAt' };

        if (args.pushStatusId) {
          queryOptions.where = { objectId: args.pushStatusId };
          queryOptions.limit = 1;
        } else {
          queryOptions.limit = args.limit || 10;
        }

        const result = await parseClient.queryObjects('_PushStatus', queryOptions);

        if (result.results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No push notification history found.',
              },
            ],
          };
        }

        const output = [`📊 Push Notification Status (${result.results.length}):`, ''];

        for (const push of result.results) {
          const status = push.status as string;
          const statusEmoji =
            status === 'succeeded' ? '✅' : status === 'failed' ? '❌' : status === 'running' ? '🔄' : '⏳';

          output.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          output.push(`${statusEmoji} Status: ${status}`);
          output.push(`   ID: ${push.objectId}`);
          output.push(`   Sent: ${push.createdAt}`);
          if (push.numSent !== undefined) output.push(`   Delivered: ${push.numSent}`);
          if (push.numFailed !== undefined) output.push(`   Failed: ${push.numFailed}`);
          if (push.count !== undefined) output.push(`   Target Count: ${push.count}`);
          if (push.pushTime) output.push(`   Push Time: ${push.pushTime}`);
          if (push.query) output.push(`   Query: ${JSON.stringify(push.query)}`);
          if (push.failedPerType) output.push(`   Failures by Type: ${JSON.stringify(push.failedPerType)}`);
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
              text: `❌ Failed to get push status: ${message}`,
            },
          ],
        };
      }
    }
  );

  // List Available Devices
  server.tool(
    'list_available_devices',
    'List the device types configured for push notifications (iOS, Android, etc.)',
    {
      appObjectId: z.string().describe('The application object ID'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        const devices = await parseClient.listAvailableDevices();

        if (devices.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  '📱 No push notification providers configured.',
                  '',
                  'To enable push notifications, configure your push credentials in the SashiDo Dashboard:',
                  '  • iOS: Upload your APNs certificate or key',
                  '  • Android: Add your FCM server key',
                ].join('\n'),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `📱 Available Push Devices:`,
                '',
                ...devices.map(d => `  • ${d}`),
                '',
                `These device types are configured and can receive push notifications.`,
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Failed to list devices: ${message}`,
            },
          ],
        };
      }
    }
  );
}
