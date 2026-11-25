import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';
import { SashidoClient } from '../../client/sashido.js';
import { IN_PROGRESS, deploymentState, describeDeploymentState, newRecord } from '../infrastructure/deployments.js';

export function registerDeploymentTools(server: ToolServer, ctx: ToolContext): void {
  const getAuthFromRequest = (_args?: unknown, _extra?: unknown): string => ctx.token;
  // Get Deployment Info
  server.tool(
    'get_deployment_info',
    "What serves traffic now, what is rolling out, and the deployment history: what started each deployment (a settings, environment variable or domain change by name, with before → after for settings that hold nothing secret; a build and its commit) and who (the user, the access token, through the dashboard, the API, MCP or GitHub).",
    {
      appObjectId: z.string().describe('The application object ID'),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      const state = await deploymentState(client, args.appObjectId);
      return { content: [{ type: 'text' as const, text: describeDeploymentState(state).join('\n') }] };
    }
  );

  // Deploy App
  server.tool(
    'deploy_app',
    "Roll the app out again with its current build and settings. Use it when a change needs a new deployment, or to restart an app that misbehaves. Follow with wait_for_deployment.",
    {
      appObjectId: z.string().describe('The application object ID'),
      region: z.string().optional().describe('Target region (optional)'),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      const before = await deploymentState(client, args.appObjectId);
      await client.deployApp(args.appObjectId, args.region);
      const record = await newRecord(client, args.appObjectId, before);
      const lines = [
        `Deployment started for app ${args.appObjectId}.`,
        record
          ? `In the deployment history it is ${record.name}: cancel_deployment with deploymentName="${record.name}" stops it while it rolls out.`
          : "It isn't in the deployment history (yet), so it can't be cancelled by name now; get_deployment_info shows it once it is.",
        `wait_for_deployment with after: ${before.serving ? before.serving.number : 0} waits until it serves traffic.`,
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] };
    }
  );

  // Cancel Deployment
  server.tool(
    'cancel_deployment',
    'Cancel a deployment that is rolling out. Takes its name in the deployment history (from get_deployment_info or deploy_app), which differs from the name of the containers serving traffic.',
    {
      appObjectId: z.string().describe('The application object ID'),
      deploymentName: z.string().describe("The deployment's name in the history, e.g. from get_deployment_info"),
      region: z.string().optional().describe('Target region (optional)'),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);
      const state = await deploymentState(client, args.appObjectId);
      const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

      if (state.records) {
        const record = state.records.find((d) => d.name === args.deploymentName);
        const rolling = state.rolling ? `"${state.rolling.name}"` : 'none';
        if (!record) {
          const serves = state.serving && state.serving.name === args.deploymentName;
          return text(
            `❌ No deployment "${args.deploymentName}" in the deployment history${serves ? ' (that is the name of the containers serving traffic, not the history\'s)' : ''}. Rolling out in the history: ${rolling}.`,
          );
        }
        if (!IN_PROGRESS.includes(record.phase)) {
          return text(`❌ ${record.name} isn't rolling out: it is ${record.phase}. Rolling out in the history: ${rolling}.`);
        }
      }

      await client.cancelDeployment(args.appObjectId, args.deploymentName, args.region);
      return text(`Deployment "${args.deploymentName}" cancelled. get_deployment_info shows what serves traffic.`);
    }
  );

  // Scale App
  server.tool(
    'scale_app',
    "Set how many instances run the app (min), or turn auto-scaling on between min and max. Use it when get_process_metrics shows the CPU at its limit, or one instance isn't enough for the traffic. It affects billing, and only the app's owner can do it. Check the current values with get_app_infrastructure first.",
    {
      appObjectId: z.string().describe('The application object ID'),
      // both are required: the API computes the new limits from them, and
      // a missing one turns into NaN instances and NaN billed usage
      min: z.number().int().min(1).describe('Minimum number of instances (the number that runs when auto-scaling is off)'),
      max: z.number().int().min(1).describe('Maximum number of instances (with auto-scaling); at least min'),
      auto: z.boolean().describe('Enable auto-scaling'),
      cpuTarget: z.number().optional().describe('CPU target percentage for auto-scaling'),
      region: z.string().optional().describe('Target region (optional)'),
    },
    async (args, extra) => {
      if (args.max < args.min) {
        return { content: [{ type: 'text' as const, text: `❌ max (${args.max}) can't be less than min (${args.min}).` }] };
      }
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      await client.setScale(
        args.appObjectId,
        {
          min: args.min,
          max: args.max,
          auto: args.auto,
          cpuTarget: args.cpuTarget,
        },
        args.region
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Scaling configuration updated for app ${args.appObjectId}`,
          },
        ],
      };
    }
  );

  // Set High Availability
  server.tool(
    'set_high_availability',
    "Turn high availability on or off. With it on the app always runs at least three instances with health checks, so one can restart without clients noticing. It affects billing and resets the scaling limits, and only the app's owner can do it.",
    {
      appObjectId: z.string().describe('The application object ID'),
      enabled: z.boolean().describe('Enable or disable high availability'),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      await client.setHighAvailability(args.appObjectId, args.enabled);

      return {
        content: [
          {
            type: 'text' as const,
            text: `High availability ${args.enabled ? 'enabled' : 'disabled'} for app ${args.appObjectId}`,
          },
        ],
      };
    }
  );

  // Update App Name
  server.tool(
    'update_app_name',
    "Rename an app. Its objectId, keys and URLs stay the same.",
    {
      appObjectId: z.string().describe('The application object ID'),
      name: z.string().describe('New application name'),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      await client.updateAppName(args.appObjectId, args.name);

      return {
        content: [
          {
            type: 'text' as const,
            text: `App name updated to "${args.name}"`,
          },
        ],
      };
    }
  );
}
