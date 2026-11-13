import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';

export function registerObjectTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // Query Objects
  server.tool(
    'query_objects',
    'Query objects from a class with optional filters, sorting, and pagination',
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name to query'),
      where: z
        .string()
        .optional()
        .describe('JSON string of query constraints (e.g., {"score": {"$gt": 10}})'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of results to return (default 100, max 1000)'),
      skip: z.number().optional().describe('Number of results to skip for pagination'),
      order: z
        .string()
        .optional()
        .describe('Field(s) to sort by. Prefix with - for descending (e.g., "-createdAt" or "name,-score")'),
      keys: z
        .string()
        .optional()
        .describe('Comma-separated list of fields to return (e.g., "name,email")'),
      include: z
        .string()
        .optional()
        .describe('Comma-separated list of pointer fields to include full objects for'),
      count: z.boolean().optional().describe('If true, also return the total count of matching objects'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);

      const options: {
        where?: Record<string, unknown>;
        limit?: number;
        skip?: number;
        order?: string;
        keys?: string;
        include?: string;
        count?: boolean;
      } = {};

      if (args.where) {
        try {
          options.where = JSON.parse(args.where);
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
      }

      if (args.limit !== undefined) options.limit = Math.min(args.limit, 1000);
      if (args.skip !== undefined) options.skip = args.skip;
      if (args.order) options.order = args.order;
      if (args.keys) options.keys = args.keys;
      if (args.include) options.include = args.include;
      if (args.count) options.count = args.count;

      const result = await parseClient.queryObjects(args.className, options);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                results: result.results,
                count: result.count,
                returned: result.results.length,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Get Single Object
  server.tool(
    'get_object',
    'Get a single object by its objectId',
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      objectId: z.string().describe('The object ID to retrieve'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);
      const object = await parseClient.getObject(args.className, args.objectId);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(object, null, 2),
          },
        ],
      };
    }
  );

  // Create Object
  server.tool(
    'create_object',
    'Create a new object in a class',
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      data: z.string().describe('JSON string of the object data to create'),
    },
    async (args, extra) => {
      let objectData: Record<string, unknown>;
      try {
        objectData = JSON.parse(args.data);
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

      const parseClient = await getParseClient(args, extra);
      const result = await parseClient.createObject(args.className, objectData);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Object created successfully.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // Update Object
  server.tool(
    'update_object',
    'Update an existing object by its objectId',
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      objectId: z.string().describe('The object ID to update'),
      data: z.string().describe('JSON string of the fields to update'),
    },
    async (args, extra) => {
      let updateData: Record<string, unknown>;
      try {
        updateData = JSON.parse(args.data);
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

      const parseClient = await getParseClient(args, extra);
      const result = await parseClient.updateObject(args.className, args.objectId, updateData);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Object updated successfully.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }
  );

  // Delete Object
  server.tool(
    'delete_object',
    'Delete an object by its objectId. WARNING: This action is irreversible!',
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      objectId: z.string().describe('The object ID to delete'),
      confirmDelete: z
        .boolean()
        .describe('Must be true to confirm deletion. This action is irreversible!'),
    },
    async (args, extra) => {
      if (!args.confirmDelete) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Deletion cancelled. Set confirmDelete to true to proceed.',
            },
          ],
        };
      }

      const parseClient = await getParseClient(args, extra);
      await parseClient.deleteObject(args.className, args.objectId);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Object ${args.objectId} deleted from class "${args.className}" successfully.`,
          },
        ],
      };
    }
  );
}
