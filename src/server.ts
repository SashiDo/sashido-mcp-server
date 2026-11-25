import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appConfig } from './config.js';
import { ToolContext, ToolServer, toolServer } from './context.js';
import { registerAppTools } from './tools/apps/index.js';
import { registerBuildTools } from './tools/builds/index.js';
import { registerDeploymentTools } from './tools/deployments/index.js';
import { registerEnvTools } from './tools/env/index.js';
import { registerSettingsTools } from './tools/settings/index.js';
import { registerEngineTools } from './tools/engines/index.js';
import { registerHealthTools } from './tools/health/index.js';
import { registerMetricsTools } from './tools/metrics/index.js';
import { registerJobTools } from './tools/jobs/index.js';
import { registerLogTools } from './tools/logs/index.js';
import { registerClassTools } from './tools/classes/index.js';
import { registerObjectTools } from './tools/objects/index.js';
import { registerFileTools } from './tools/files/index.js';
import { registerCloudFunctionTools } from './tools/cloud-functions/index.js';
import { registerPushTools } from './tools/push/index.js';
import { registerWebhookTools } from './tools/webhooks/index.js';
import { registerInfrastructureTools } from './tools/infrastructure/index.js';
import { registerAuditTools } from './tools/audit/index.js';
import { registerTypeTools } from './tools/types/index.js';
import { registerAdvisorTools } from './tools/advisor/index.js';

import { SERVER_NAME, SERVER_VERSION } from './version.js';

export { SERVER_NAME, SERVER_VERSION };

/** Tool groups (the `features` option), each the folder under src/tools */
export const TOOL_GROUPS: Record<string, (server: ToolServer, ctx: ToolContext) => void> = {
  apps: registerAppTools,
  builds: registerBuildTools,
  deployments: registerDeploymentTools,
  infrastructure: registerInfrastructureTools,
  audit: registerAuditTools,
  types: registerTypeTools,
  advisor: registerAdvisorTools,
  env: registerEnvTools,
  settings: registerSettingsTools,
  engines: registerEngineTools,
  health: registerHealthTools,
  metrics: registerMetricsTools,
  classes: registerClassTools,
  objects: registerObjectTools,
  files: registerFileTools,
  'cloud-functions': registerCloudFunctionTools,
  push: registerPushTools,
  jobs: registerJobTools,
  logs: registerLogTools,
  webhooks: registerWebhookTools,
};

/**
 * An MCP server for one access token: only the tools its scopes, read-only
 * mode, app limit and feature groups allow are registered.
 */
export function createServer(ctx: ToolContext, registered: string[] = []): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const [group, register] of Object.entries(TOOL_GROUPS)) {
    register(toolServer(server, group, ctx.access, registered, ctx), ctx);
  }

  if (appConfig.logLevel === 'debug') {
    console.error(`[MCP] Server created with ${registered.length} tools`);
  }

  return server;
}

export { McpServer };
