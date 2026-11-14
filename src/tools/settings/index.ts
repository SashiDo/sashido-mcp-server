import { z } from "zod";
import { ToolContext, ToolServer } from "../../context.js";
import { CustomDomain } from "../../client/settings.js";
import { deploymentState } from "../infrastructure/deployments.js";

// App Settings and the custom domain. The API saves them as the user, so
// they are checked exactly as in the dashboard (Parse Server version, email
// sender rules, DNS) and refusals come back with the reason. Secrets
// (client secrets, app and consumer secrets) can be set, never read.

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const section = (fields: string) =>
  z.record(z.string(), z.unknown()).optional().describe(fields);

const SETTINGS_SHAPE = {
  users: section(
    "usernameAndPassword, anonymousUsers (booleans); sessionLengthSeconds; expireInactiveSessions, revokeSessionOnPasswordReset; passwordPolicy {validatorPattern, doNotAllowUsername, maxPasswordAgeDays, maxPasswordHistory, resetTokenValidityDurationSeconds}; accountLockout {threshold, durationMinutes} or null; preventLoginWithUnverifiedEmail; emailVerifyTokenValidityDurationSeconds; mfaTotp (end-user TOTP multi-factor authentication)",
  ),
  socialLogin: section(
    "Per provider: google {enabled, clientIds[]}; github, linkedin, microsoft {enabled, clientId, clientSecret, acceptAccessToken}; apple {enabled, bundleId}; facebook {enabled, appId, appSecret}; twitter {enabled, consumerKey, consumerSecret}. Naming a field switches the provider on; {enabled: false} switches it off. A new clientId needs its clientSecret in the same call.",
  ),
  email: section("verifyUserEmails; senderAddress; senderDisplayName"),
  customPages: section("URLs: choosePassword, passwordChanged, emailVerified, invalidVerification"),
  push: section("clientPush, restPush, advancedDiagnostics"),
  liveQueries: section("classes: the class names Live Queries are on for"),
  api: section(
    "allowClientClassCreation, maxLimit, allowHeaders[], preserveFileName, allowCustomObjectId, logLevel, userSensitiveFields[], protectedFields",
  ),
};

function describeDomain(d: CustomDomain): string {
  if (!d.hostName) {
    return `No custom domain. To add one, create a CNAME record from the host name to ${d.dns.target}, then call set_custom_domain.`;
  }
  const lines = [
    `Custom domain: ${d.hostName} (Let's Encrypt certificate: ${d.letsEncrypt ? "on" : "off"}).`,
    "DNS records it needs (one of them):",
    ...d.dns.records.map((r) => `- ${r}`),
  ];
  return lines.join("\n");
}

/** Where a change that redeploys can be waited for */
async function servingNumber(ctx: ToolContext, appObjectId: string): Promise<number | null> {
  const state = await deploymentState(ctx.sashido(), appObjectId).catch(() => null);
  return state && state.serving ? state.serving.number : null;
}

function rolloutHint(redeploys: boolean | undefined, before: number | null): string {
  if (!redeploys) {
    return "The app doesn't need to redeploy for this.";
  }
  const after = before === null ? "" : ` with after: ${before}`;
  return `The app redeploys to apply it (one to three minutes): call wait_for_deployment${after} to know when it serves with the change.`;
}

export function registerSettingsTools(server: ToolServer, ctx: ToolContext): void {
  server.tool(
    "get_app_settings",
    "An app's settings: user accounts and passwords, multi-factor authentication, social logins, email verification and sender, custom pages, push, Live Queries, API options. `availability` names the Parse Server version a setting needs when the app's is older. Secrets are never shown, only whether they are set.",
    { appObjectId: z.string().describe("The application object ID") },
    async (args) => {
      const settings = await ctx.sashido().getAppSettings(args.appObjectId);
      return text(JSON.stringify(settings, null, 2));
    },
  );

  server.tool(
    "update_app_settings",
    "Change an app's settings: give only what changes, in the sections get_app_settings shows; everything else stays as it is. Checked as in the dashboard: a setting the app's Parse Server version lacks, or an email sender that isn't allowed, is refused with the reason. Most changes redeploy the app.",
    { appObjectId: z.string().describe("The application object ID"), ...SETTINGS_SHAPE },
    async (args) => {
      const { appObjectId, ...sections } = args;
      const patch = Object.fromEntries(
        Object.entries(sections).filter(([, v]) => v !== undefined),
      ) as Record<string, Record<string, unknown>>;
      if (!Object.keys(patch).length) {
        return text("Error: nothing to change. Give at least one section, e.g. users: { mfaTotp: true }.");
      }
      const before = await servingNumber(ctx, appObjectId);
      const result = await ctx.sashido().updateAppSettings(appObjectId, patch);
      return text(
        `Saved. ${rolloutHint(result.redeploys, before)}\n\nSettings now:\n${JSON.stringify(result.settings, null, 2)}`,
      );
    },
  );

  server.tool(
    "get_custom_domain",
    "An app's custom domain, whether it has a Let's Encrypt certificate, and the CNAME record the domain needs.",
    { appObjectId: z.string().describe("The application object ID") },
    async (args) => text(describeDomain(await ctx.sashido().getCustomDomain(args.appObjectId))),
  );

  server.tool(
    "set_custom_domain",
    "Serve an app's API on a custom domain (e.g. api.example.com), optionally with a free Let's Encrypt certificate. The domain must already point to the app with a CNAME record (get_custom_domain names it); otherwise it's refused with the record to create. Redeploys the app.",
    {
      appObjectId: z.string().describe("The application object ID"),
      hostName: z.string().min(3).max(253).describe("The host name, e.g. api.example.com"),
      letsEncrypt: z.boolean().optional().describe("Get a Let's Encrypt certificate for it"),
    },
    async (args) => {
      const before = await servingNumber(ctx, args.appObjectId);
      const body: { hostName: string; letsEncrypt?: boolean } = { hostName: args.hostName };
      if (args.letsEncrypt !== undefined) {
        body.letsEncrypt = args.letsEncrypt;
      }
      const domain = await ctx.sashido().setCustomDomain(args.appObjectId, body);
      return text(`${describeDomain(domain)}\n\n${rolloutHint(domain.redeploys, before)}`);
    },
  );

  server.tool(
    "remove_custom_domain",
    "Stop serving an app on its custom domain (and drop its Let's Encrypt certificate). Clients using that domain stop reaching the app. Redeploys the app.",
    { appObjectId: z.string().describe("The application object ID") },
    async (args) => {
      const before = await servingNumber(ctx, args.appObjectId);
      const domain = await ctx.sashido().removeCustomDomain(args.appObjectId);
      return text(`Custom domain removed. ${rolloutHint(domain.redeploys, before)}`);
    },
  );
}
