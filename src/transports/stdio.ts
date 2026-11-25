import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allScopes, narrowAccess } from '../access.js';
import { accessFromTokenInfo, getTokenInfo, isAccessToken } from '../auth.js';
import { appConfig } from '../config.js';
import { createToolContext } from '../context.js';
import { createServer } from '../server.js';

const HOW_TO_GET_A_TOKEN =
  'Set SASHIDO_ACCESS_TOKEN to a SashiDo personal access token (sashido_pat_...). ' +
  'Create one in the dashboard: Account > Access Tokens.';

/** What a tool answers when the server was started without a token */
export const NO_TOKEN =
  'This server was started without an access token, so it can list its tools but not run them. ' +
  HOW_TO_GET_A_TOKEN +
  ' Then restart the server.';

export interface StdioOptions {
  token?: string;
  readOnly?: string;
  apps?: string;
  features?: string;
}

/**
 * The server for local use (Claude Desktop, Cursor, ...): the token comes
 * from SASHIDO_ACCESS_TOKEN, and SASHIDO_READ_ONLY / SASHIDO_APPS /
 * SASHIDO_FEATURES can narrow it. Local file and URL uploads are available.
 *
 * Without a token it still starts, with every tool listed and none that
 * runs: catalogs and inspectors start a server only to ask what it can do,
 * and someone who forgot the token gets told how to make one by the first
 * tool they call, instead of a server that won't start. A token that is
 * there but wrong still stops the start, as a mistake to fix.
 */
export async function createStdioServer(
  options: StdioOptions,
): Promise<{ server: McpServer; tools: string[]; user?: string }> {
  const narrow = { readOnly: options.readOnly, apps: options.apps, features: options.features };
  const tools: string[] = [];

  if (!options.token) {
    const everything = { scopes: allScopes(), appIds: null, readOnly: false, groups: null, local: true };
    const ctx = createToolContext('', narrowAccess(everything, narrow));
    ctx.needsToken = NO_TOKEN;
    return { server: createServer(ctx, tools), tools };
  }

  if (!isAccessToken(options.token)) {
    throw new Error(HOW_TO_GET_A_TOKEN);
  }
  const info = await getTokenInfo(options.token);
  const access = narrowAccess(accessFromTokenInfo(info, true), narrow);
  return {
    server: createServer(createToolContext(options.token, access), tools),
    tools,
    user: info.user.username,
  };
}

export async function startStdioServer(): Promise<void> {
  const { server, tools, user } = await createStdioServer({
    token: appConfig.stdio.accessToken,
    readOnly: appConfig.stdio.readOnly,
    apps: appConfig.stdio.apps,
    features: appConfig.stdio.features,
  });

  await server.connect(new StdioServerTransport());
  console.error(
    user
      ? `[MCP] Connected as ${user} with ${tools.length} tools`
      : `[MCP] No SASHIDO_ACCESS_TOKEN: ${tools.length} tools are listed, and none runs until it is set`,
  );
}
