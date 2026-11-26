import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';
import type { ParseSchema } from '../../client/parse.js';

// every class has these; listing them for each one only costs the reader
const EVERYWHERE = ['objectId', 'createdAt', 'updatedAt', 'ACL'];

/**
 * The data model as one line per class, the app's own classes first:
 *   Note: title String, author Pointer<_User>
 * A JSON listing of the same was ten times as long, most of it the fields
 * every class has and the built-in classes.
 */
export function formatClasses(schemas: ParseSchema[]): string {
  const line = (s: ParseSchema) => {
    const fields = Object.entries(s.fields)
      .filter(([name]) => EVERYWHERE.indexOf(name) === -1)
      .map(([name, def]) => `${name} ${def.type}${def.targetClass ? `<${def.targetClass}>` : ''}`);
    return `${s.className}: ${fields.length ? fields.join(', ') : '(no fields of its own)'}`;
  };
  const own = schemas.filter((s) => s.className.indexOf('_') !== 0).sort((a, b) => a.className.localeCompare(b.className));
  const builtIn = schemas.filter((s) => s.className.indexOf('_') === 0).sort((a, b) => a.className.localeCompare(b.className));
  return [
    `${own.length} class${own.length === 1 ? '' : 'es'} of the app's own, ${builtIn.length} built in. Every class also has ${EVERYWHERE.join(', ')}.`,
    '',
    ...(own.length ? own.map(line) : ["(the app has no classes of its own yet)"]),
    '',
    'Built in:',
    ...builtIn.map(line),
    '',
    'get_class shows one class in full, with who may read and write it.',
  ].join('\n');
}

export function registerClassTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // List Classes
  server.tool(
    'list_classes',
    "An app's data model: every class with its fields and their types, one line per class, the app's own classes first. Read it before writing queries, cloud code or client code against the app. get_class shows one class in full, with its permissions.",
    {
      appObjectId: z.string().describe('The application object ID'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);
      const schemas = await parseClient.listClasses();

      return { content: [{ type: 'text' as const, text: formatClasses(schemas) }] };
    }
  );

  // Get Class Schema
  server.tool(
    'get_class',
    "One class of an app: its fields, their types and what pointers point to.",
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);
      const schema = await parseClient.getClass(args.className);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                className: schema.className,
                fields: schema.fields,
                classLevelPermissions: schema.classLevelPermissions,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Create Class
  server.tool(
    'create_class',
    "Create a class (a collection, like a table) with its fields, pointers to other classes included. Use it to design the data model of a new app or feature. Set who may read and write it with update_class_permissions right after, then generate_types for the client code.",
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name to create'),
      fields: z
        .record(z.object({ type: z.string(), targetClass: z.string().optional() }))
        .optional()
        .describe(
          'The fields, by name: {"title": {"type": "String"}, "author": {"type": "Pointer", "targetClass": "_User"}}. A Pointer or Relation needs targetClass.'
        ),
    },
    async (args, extra) => {
      // Parse answers a pointer without its class with a bare 500
      const untargeted = Object.entries(args.fields ?? {})
        .filter(([, f]) => (f.type === 'Pointer' || f.type === 'Relation') && !f.targetClass)
        .map(([name]) => name);
      if (untargeted.length) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Nothing was created. A Pointer or Relation field needs targetClass, the class it points to (e.g. {"type": "Pointer", "targetClass": "_User"}): ${untargeted.join(', ')}.`,
            },
          ],
        };
      }
      const parseClient = await getParseClient(args, extra);
      const schema = await parseClient.createClass(args.className, args.fields);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Class "${args.className}" created successfully.\n\n${JSON.stringify(schema, null, 2)}`,
          },
        ],
      };
    }
  );

  // Delete Class
  server.tool(
    'delete_class',
    'Delete a class (schema) from the Parse Server application. Parse refuses a class that still has objects: delete them first. Irreversible.',
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name to delete'),
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
      await parseClient.deleteClass(args.className);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Class "${args.className}" deleted successfully.`,
          },
        ],
      };
    }
  );

  // Add Field
  server.tool(
    'add_field',
    "Add a field to a class: a String, Number, Boolean, Date, File, GeoPoint, Polygon, Array or Object, or a Pointer or Relation to another class (targetClass).",
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      fieldName: z.string().describe('The field name to add'),
      fieldType: z
        .enum([
          'String',
          'Number',
          'Boolean',
          'Date',
          'File',
          'GeoPoint',
          'Polygon',
          'Array',
          'Object',
          'Pointer',
          'Relation',
        ])
        .describe('The field type'),
      targetClass: z
        .string()
        .optional()
        .describe('For Pointer/Relation types, the target class name'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);
      const schema = await parseClient.addField(
        args.className,
        args.fieldName,
        args.fieldType,
        args.targetClass
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Field "${args.fieldName}" (${args.fieldType}) added to class "${args.className}".\n\n${JSON.stringify(schema.fields, null, 2)}`,
          },
        ],
      };
    }
  );

  // Delete Field
  server.tool(
    'delete_field',
    "Remove a field from a class, with its value in every object. It can't be undone.",
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      fieldName: z.string().describe('The field name to delete'),
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
      await parseClient.deleteField(args.className, args.fieldName);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Field "${args.fieldName}" deleted from class "${args.className}".`,
          },
        ],
      };
    }
  );

  // Get Class Level Permissions
  server.tool(
    'get_class_permissions',
    "The class-level permissions of a class: who may get, find, count, create, update and delete its objects, and add fields. Use it to check that a class isn't open to everyone before the app ships.",
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);
      const schema = await parseClient.getClass(args.className);

      const clp = schema.classLevelPermissions || {};

      // Format CLPs nicely
      const operations = ['find', 'get', 'create', 'update', 'delete', 'addField'];
      const formatted = operations.map(op => {
        const perm = clp[op] || {};
        const access = Object.entries(perm)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ') || 'No permissions set';
        return `${op}: ${access}`;
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Class Level Permissions for "${args.className}":\n\n${formatted.join('\n')}\n\nRaw CLP:\n${JSON.stringify(clp, null, 2)}`,
          },
        ],
      };
    }
  );

  // Update Class Level Permissions
  server.tool(
    'update_class_permissions',
    "Set who may get, find, create, update and delete the objects of a class, and add fields to it: everyone (\"*\"), any signed-in user (requiresAuthentication), a role (role:Name) or a user's id. Use it to lock a class down. Clients that relied on the old permissions stop working, so check get_class_permissions first.",
    {
      appObjectId: z.string().describe('The application object ID'),
      className: z.string().describe('The class name'),
      permissions: z
        .string()
        .describe(
          'JSON string of CLP object. Example: {"find":{"*":true},"create":{"role:Admin":true},"delete":{"requiresAuthentication":true}}'
        ),
    },
    async (args, extra) => {
      let clp: Record<string, Record<string, boolean>>;
      try {
        clp = JSON.parse(args.permissions);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Invalid JSON in "permissions" parameter.\n\nExample format:\n{\n  "find": { "*": true },\n  "get": { "*": true },\n  "create": { "requiresAuthentication": true },\n  "update": { "role:Admin": true },\n  "delete": { "role:Admin": true },\n  "addField": { "role:Admin": true }\n}',
            },
          ],
        };
      }

      const parseClient = await getParseClient(args, extra);
      const schema = await parseClient.updateClassLevelPermissions(args.className, clp);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Class Level Permissions updated for "${args.className}".\n\nNew CLP:\n${JSON.stringify(schema.classLevelPermissions, null, 2)}`,
          },
        ],
      };
    }
  );
}
