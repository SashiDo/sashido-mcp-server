import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// Helper to guess content type from filename
function guessContentType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();
  const contentTypes: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Text
    'txt': 'text/plain',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'application/xml',
    // Media
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'wav': 'audio/wav',
    // Archives
    'zip': 'application/zip',
    'gz': 'application/gzip',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
}

export function registerFileTools(server: ToolServer, ctx: ToolContext): void {
  const getParseClient = async (args: { appObjectId: string }, _extra?: unknown) =>
    ctx.parse(args.appObjectId);
  // Upload File from Base64
  server.tool(
    'upload_file',
    'Upload a file to Parse Server from base64-encoded data',
    {
      appObjectId: z.string().describe('The application object ID'),
      fileName: z.string().describe('The file name with extension (e.g., "image.png")'),
      base64Data: z.string().describe('Base64-encoded file data'),
      contentType: z
        .string()
        .optional()
        .describe('Content type (e.g., "image/png"). Will be guessed from extension if not provided.'),
    },
    async (args, extra) => {
      const parseClient = await getParseClient(args, extra);

      const contentType = args.contentType || guessContentType(args.fileName);
      const fileData = Buffer.from(args.base64Data, 'base64');

      const result = await parseClient.uploadFile(args.fileName, fileData, contentType);

      return {
        content: [
          {
            type: 'text' as const,
            text: `File uploaded successfully!\n\nName: ${result.name}\nURL: ${result.url}\n\nTo use this file in an object, set the field value to:\n${JSON.stringify({ __type: 'File', name: result.name, url: result.url }, null, 2)}`,
          },
        ],
      };
    }
  );

  // Upload File from URL
  server.tool(
    'upload_file_from_url',
    'Download a file from a URL and upload it to Parse Server',
    {
      appObjectId: z.string().describe('The application object ID'),
      sourceUrl: z.string().url().describe('The URL to download the file from'),
      fileName: z
        .string()
        .optional()
        .describe('Optional file name. Will be extracted from URL if not provided.'),
    },
    async (args, extra) => {
      // Download file from URL
      const response = await axios.get(args.sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      // Extract filename from URL or use provided
      let fileName = args.fileName;
      if (!fileName) {
        const urlPath = new URL(args.sourceUrl).pathname;
        fileName = urlPath.split('/').pop() || 'file';
      }

      const contentType = response.headers['content-type'] || guessContentType(fileName);
      const fileData = Buffer.from(response.data);

      const parseClient = await getParseClient(args, extra);
      const result = await parseClient.uploadFile(fileName, fileData, contentType);

      return {
        content: [
          {
            type: 'text' as const,
            text: `File uploaded successfully!\n\nSource: ${args.sourceUrl}\nName: ${result.name}\nURL: ${result.url}\nSize: ${fileData.length} bytes\n\nTo use this file in an object, set the field value to:\n${JSON.stringify({ __type: 'File', name: result.name, url: result.url }, null, 2)}`,
          },
        ],
      };
    }
  );

  // Upload File from local path (fastest - no LLM processing needed)
  server.tool(
    'upload_file_from_path',
    'Upload a local file to Parse Server. This is the fastest method - just provide the file path.',
    {
      appObjectId: z.string().describe('The application object ID'),
      filePath: z.string().describe('Absolute path to the local file (e.g., "/Users/me/image.png")'),
      fileName: z
        .string()
        .optional()
        .describe('Optional custom file name. Will use original filename if not provided.'),
    },
    async (args, extra) => {
      // Check if file exists
      if (!fs.existsSync(args.filePath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: File not found at path: ${args.filePath}`,
            },
          ],
        };
      }

      // Read file from disk
      const fileData = fs.readFileSync(args.filePath);
      const fileName = args.fileName || path.basename(args.filePath);
      const contentType = guessContentType(fileName);

      const parseClient = await getParseClient(args, extra);
      const result = await parseClient.uploadFile(fileName, fileData, contentType);

      return {
        content: [
          {
            type: 'text' as const,
            text: `File uploaded successfully!\n\nSource: ${args.filePath}\nName: ${result.name}\nURL: ${result.url}\nSize: ${fileData.length} bytes\n\nTo use this file in an object, set the field value to:\n${JSON.stringify({ __type: 'File', name: result.name, url: result.url }, null, 2)}`,
          },
        ],
      };
    }
  );
}
