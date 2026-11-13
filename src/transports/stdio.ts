import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { narrowAccess } from '../access.js';
import { accessFromTokenInfo, getTokenInfo, isAccessToken } from '../auth.js';
import { appConfig } from '../config.js';
import { createToolContext } from '../context.js';
import { createServer } from '../server.js';

/**
 * Local use (Claude Desktop, Cursor, ...): the token comes from
 * SASHIDO_ACCESS_TOKEN, and SASHIDO_READ_ONLY / SASHIDO_APPS /
 * SASHIDO_FEATURES can narrow it. Local file and URL uploads are available.
 */
export async function startStdioServer(): Promise<void> {
  const token = appConfig.stdio.accessToken;
  if (!token || !isAccessToken(token)) {
    throw new Error(
      'Set SASHIDO_ACCESS_TOKEN to a SashiDo personal access token (sashido_pat_...). ' +
        'Create one in the dashboard: Account > Access Tokens.',
    );
  }

  const info = await getTokenInfo(token);
  const access = narrowAccess(accessFromTokenInfo(info, true), {
    readOnly: appConfig.stdio.readOnly,
    apps: appConfig.stdio.apps,
    features: appConfig.stdio.features,
  });
  const registered: string[] = [];
  const server = createServer(createToolContext(token, access), registered);

  await server.connect(new StdioServerTransport());
  console.error(`[MCP] Connected as ${info.user.username} with ${registered.length} tools`);
}
