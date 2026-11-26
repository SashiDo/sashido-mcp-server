import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';
import { SashidoClient } from '../../client/sashido.js';

/** The plan gives an engine's memory in bytes; older data had megabytes */
export function memory(value: unknown): string {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) {
    return '? RAM';
  }
  const mb = n >= 1024 * 1024 ? n / (1024 * 1024) : n;
  return mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB RAM` : `${Math.round(mb)} MB RAM`;
}

export function registerEngineTools(server: ToolServer, ctx: ToolContext): void {
  const getAuthFromRequest = (_args?: unknown, _extra?: unknown): string => ctx.token;
  // List Available Engines
  server.tool(
    'list_engines',
    "The engines the account's plan offers: the CPU and memory of each, what it costs, and whether it supports auto-scaling and high availability. Read it before set_engine.",
    {
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      const engines = await client.listEngines();

      // Format engines for display
      const formatted = engines.map(e => ({
        name: e.name,
        billingPolicy: e.billingPolicy,
        price: `$${e.price}/${e.billingPolicy === 'monthly' ? 'month' : 'hour'}`,
        cpu: `${e.params?.cpu ?? e.cpu ?? '?'} CPU`,
        ram: memory(e.params?.ram ?? e.ram),
        features: [
          e.supportsAutoScaling ? 'Auto-scaling' : null,
          e.supportsHighAvailability ? 'High Availability' : null,
          e.allowedInTrial ? 'Available in Trial' : null,
          e.default ? 'Default' : null,
        ].filter(Boolean).join(', ') || 'Standard',
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: `Available Parse Server Engines:\n\n${JSON.stringify(formatted, null, 2)}\n\nNote: Pricing shown is per container. Visit https://dashboard.sashido.io for full pricing details.`,
          },
        ],
      };
    }
  );

  // Change Engine
  server.tool(
    'set_engine',
    "Change an app's engine: the CPU and memory each of its instances has. Use it when get_process_metrics shows the engine at its memory limit, or CPU-heavy cloud code needs more. It affects billing (confirmBillingChange), only the app's owner can do it, and the app is redeployed.",
    {
      appObjectId: z.string().describe('The application object ID'),
      engineName: z.string().describe('The engine name (e.g., "pico", "nano", "micro", "small", "medium", "large")'),
      billingPolicy: z
        .enum(['monthly', 'hourly'])
        .describe('Billing policy - "monthly" for fixed monthly rate, "hourly" for pay-per-use'),
      region: z.string().optional().describe('Target region (optional)'),
      confirmBillingChange: z
        .boolean()
        .describe('Must be true to confirm you understand this will affect your billing'),
    },
    async (args, extra) => {
      if (!args.confirmBillingChange) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `BILLING WARNING: Changing the engine will affect your monthly bill.\n\nBefore proceeding:\n1. Visit https://dashboard.sashido.io to review current pricing\n2. Use the 'list_engines' tool to see available options and their costs\n3. Set confirmBillingChange to true to proceed\n\nThis action may result in:\n- Increased or decreased monthly charges\n- A brief service interruption during the change\n- Changes to available features (auto-scaling, high availability)`,
            },
          ],
        };
      }

      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      await client.setEngine(args.appObjectId, args.engineName, args.billingPolicy, args.region);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Engine changed successfully!\n\nNew engine: ${args.engineName}\nBilling policy: ${args.billingPolicy}\n\nIMPORTANT: Your billing will be updated accordingly. Visit https://dashboard.sashido.io/billing to review your new charges.\n\nNote: A new deployment may be triggered to apply the changes.`,
          },
        ],
      };
    }
  );
}
