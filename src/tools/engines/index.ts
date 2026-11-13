import { ToolContext, ToolServer } from '../../context.js';
import { z } from 'zod';
import { SashidoClient } from '../../client/sashido.js';

export function registerEngineTools(server: ToolServer, ctx: ToolContext): void {
  const getAuthFromRequest = (_args?: unknown, _extra?: unknown): string => ctx.token;
  // List Available Engines
  server.tool(
    'list_engines',
    'List all available Parse Server engines with their specs and pricing',
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
        ram: `${e.params?.ram ?? e.ram ?? '?'} MB RAM`,
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
    'Change the Parse Server engine for an application. WARNING: This affects your monthly billing!',
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
