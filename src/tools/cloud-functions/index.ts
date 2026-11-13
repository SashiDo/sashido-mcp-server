import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';

export function registerCloudFunctionTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // Call Cloud Function
  server.tool(
    'call_cloud_function',
    'Execute a Cloud Code function on the Parse Server',
    {
      appObjectId: z.string().describe('The application object ID'),
      functionName: z.string().describe('The name of the cloud function to call'),
      params: z
        .string()
        .optional()
        .describe('JSON string of parameters to pass to the function'),
    },
    async (args, extra) => {
      let functionParams: Record<string, unknown> | undefined;

      if (args.params) {
        try {
          functionParams = JSON.parse(args.params);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Invalid JSON in "params" parameter',
              },
            ],
          };
        }
      }

      const parseClient = await getParseClient(args, extra);

      try {
        const result = await parseClient.callCloudFunction(args.functionName, functionParams);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Cloud function "${args.functionName}" executed successfully.\n\nResult:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error calling cloud function "${args.functionName}": ${message}`,
            },
          ],
        };
      }
    }
  );

  // === CLOUD CODE FILES ===

  // List Cloud Code Files
  server.tool(
    'list_cloud_files',
    'List all cloud code files deployed to the server',
    {
      appObjectId: z.string().describe('The application object ID'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        const files = await parseClient.listCloudCodeFiles();

        const output: string[] = [];

        if (files.cloudFiles.length > 0) {
          output.push('📁 Cloud Code Files:');
          output.push('');
          for (const file of files.cloudFiles) {
            output.push(`  • ${file.path}`);
          }
        }

        if (files.userFiles.length > 0) {
          if (output.length > 0) output.push('');
          output.push('📁 Public Files:');
          output.push('');
          for (const file of files.userFiles) {
            output.push(`  • ${file.path}`);
          }
        }

        if (output.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No cloud code files are deployed. Cloud code is deployed from the app\'s GitHub repository (cloud/ and public/ folders).',
              },
            ],
          };
        }

        output.push('');
        output.push('💡 Use read_cloud_code to view the contents of a file.');

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
              text: `❌ Failed to list cloud files: ${message}`,
            },
          ],
        };
      }
    }
  );

  // Read Cloud Code File
  server.tool(
    'read_cloud_code',
    'Read the contents of a cloud code file from the server. Use this to see what functions are defined.',
    {
      appObjectId: z.string().describe('The application object ID'),
      filePath: z.string().describe('The path to the file (e.g., "main.js" or "cloud/main.js")'),
    },
    async (args, extra) => {
      try {
        const parseClient = await getParseClient(args, extra);
        const content = await parseClient.readCloudCodeFile(args.filePath);

        // Try to extract function definitions for a helpful summary
        const functionMatches = content.matchAll(/Parse\.Cloud\.(define|job|beforeSave|afterSave|beforeDelete|afterDelete|beforeFind|afterFind|beforeLogin|afterLogout)\s*\(\s*['"]([\w-]+)['"]/g);
        const functions: string[] = [];
        for (const match of functionMatches) {
          functions.push(`${match[1]}: ${match[2]}`);
        }

        let output = `📄 ${args.filePath}\n${'─'.repeat(50)}\n\n${content}`;

        if (functions.length > 0) {
          output += `\n\n${'─'.repeat(50)}\n📋 Found ${functions.length} Cloud Code definitions:\n`;
          for (const fn of functions) {
            output += `  • ${fn}\n`;
          }
        }

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
              text: `❌ Failed to read cloud code file: ${message}\n\nMake sure the file path is correct. Use list_cloud_files to see available files.`,
            },
          ],
        };
      }
    }
  );
}
