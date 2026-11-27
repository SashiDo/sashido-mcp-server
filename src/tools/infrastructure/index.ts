import { z } from "zod";
import { ToolContext, ToolServer } from "../../context.js";
import { App, ParseServerVersion } from "../../client/sashido.js";
import { versionParts } from "../../upgrade/versions.js";
import { DeploymentState, IN_PROGRESS, deploymentState, describeDeploymentState, endedBadly } from "./deployments.js";
// how often wait_for_deployment looks (tests make it short)
const POLL_MS = Number(process.env.SASHIDO_POLL_MS) || 5000;
// time a poll's API calls may take, kept free before the deadline
const POLL_SLACK_MS = POLL_MS >= 1000 ? 8000 : 0;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** "release-6.5.11-preview" -> "6.5.11 (preview)" */
export function versionLabel(tag?: string): string {
  if (!tag) {
    return "unknown";
  }
  const bare = tag.replace(/^release-/, "");
  const match = /^(\d+\.\d+\.\d+)(?:-(.+))?$/.exec(bare);
  if (!match) {
    return bare;
  }
  return match[2] ? `${match[1]} (${match[2].replace(/-/g, ", ")})` : match[1]!;
}

const major = (tag?: string) => Number((/(\d+)\./.exec(tag || "") || [])[1] || 0);

/** What runs the app: version, engine, scaling, HA, deployments */
export function describeInfrastructure(app: App, state: DeploymentState | null): string {
  const settings = app.settings || {};
  const engine = (settings.engine || {})[app.region];
  const replicas = app.deployment && app.deployment.replicas;
  const limits = settings.engine_scaling_config || {};
  const lines = [
    `${app.name} (${app.objectId}), region ${app.region}`,
    `Parse Server: ${versionLabel(app.parseServerVersion)}${app.parseServerVersion ? ` [${app.parseServerVersion}]` : ""}`,
    // never guess: older APIs don't tell the engine at all
    `Engine: ${engine ? `${engine.name}, billed ${engine.billingPolicy}` : settings.engine ? "the default (Development 1X)" : "unknown (the API doesn't tell yet)"}`,
    replicas
      ? `Scaling: ${replicas.auto ? `auto, ${replicas.min} to ${replicas.max} engines` : `fixed, ${replicas.min} engine${replicas.min === 1 ? "" : "s"}`}`
      : "Scaling: unknown",
    // newer APIs tell the version and engine; then no HA flag means off
    `High availability: ${settings.highly_available ? "on" : settings.highly_available === false || app.parseServerVersion ? "off" : "unknown"}`,
  ];
  if (limits.max) {
    lines.push(`Your plan allows up to ${limits.max} engines for this app.`);
  }
  if (state) {
    lines.push("", ...describeDeploymentState(state));
  }
  return lines.join("\n");
}

async function findApp(ctx: ToolContext, appObjectId: string): Promise<App> {
  const app = (await ctx.sashido().listApps()).find((a) => a.objectId === appObjectId);
  if (!app) {
    throw new Error(`App ${appObjectId} not found.`);
  }
  return app;
}

/** "6.5.11" against what the app's health check says ("6.5.11", "v6.5.11", a tag) */
function sameVersion(reported: string, expected: string): boolean {
  const a = versionParts(reported);
  const b = versionParts(expected);
  return a[0] !== 0 && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function registerInfrastructureTools(server: ToolServer, ctx: ToolContext): void {
  server.tool(
    "get_app_infrastructure",
    "What runs an app: its Parse Server version, engine and billing, scaling, high availability, and its deployments (whether one is rolling out). Check it before changing any of them.",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args) => {
      const app = await findApp(ctx, args.appObjectId);
      const state =
        ctx.access.scopes.indexOf("apps:read") !== -1 ? await deploymentState(ctx.sashido(), app.objectId) : null;
      return text(describeInfrastructure(app, state));
    },
  );

  server.tool(
    "wait_for_deployment",
    "Wait until a newer deployment of the app serves traffic and no build is still running, e.g. after deploy_app, set_env_var, set_engine or change_parse_server_version, and say how it went. After a version switch it is done only when the app itself reports the version it was switched to. Returns before clients give up on the call (timeoutSeconds): call it again if it's still rolling out.",
    {
      appObjectId: z.string().describe("The application object ID"),
      timeoutSeconds: z
        .number()
        .int()
        .min(5)
        .max(300)
        .optional()
        .describe("How long to wait at most (default 45; some clients give up on calls after 60s)"),
      after: z
        .number()
        .int()
        .optional()
        .describe(
          "Wait for a deployment newer than this number: the one deploy_app or change_parse_server_version tell, or the previous wait_for_deployment's. Default: the one serving now",
        ),
      version: z
        .string()
        .optional()
        .describe(
          'The Parse Server version the app must report, e.g. "6.5.11". Default: the version the app is set to, so it is rarely needed',
        ),
    },
    async (args) => {
      const client = ctx.sashido();
      const deadline = Date.now() + (args.timeoutSeconds || 45) * 1000;
      const start = await deploymentState(client, args.appObjectId);
      // counted in the numbering of what serves (the containers)
      const before = args.after !== undefined ? args.after : start.serving ? start.serving.number : 0;
      // the history's deployments in progress now, or started from here on
      const known = new Set((start.records || []).map((d) => d.objectId));
      const watched = (start.rolling ? [start.rolling.objectId] : []).slice();
      // without after, nothing was just requested: say so if nothing rolls out
      const quietBy = args.after === undefined ? Date.now() + 30000 : Infinity;
      let state = start;
      for (;;) {
        // A newer deployment serving is not yet "done" when a build is still
        // running (the deployment that carries its result comes after it), or
        // when the app still reports the version it is being switched away
        // from: a version switch rolls out twice, the second time with the
        // new image.
        let pending = "";
        if (state.serving && state.serving.number > before) {
          const building = (await client.listBuilds(args.appObjectId, 3).catch(() => [])).find((b) =>
            IN_PROGRESS.includes(String((b as { phase?: string }).phase)),
          );
          // What the app should run: what the caller says, else what the app
          // is set to. A switch sets that at once, long before the app runs
          // it, and its build is not in the list of builds, so this is the
          // only sign that it is still under way.
          const set = args.version
            ? args.version
            : versionParts((await findApp(ctx, args.appObjectId).catch(() => null))?.parseServerVersion).join(".");
          const expected = set === "0.0.0" ? "" : set;
          const reported = expected
            ? String(((await ctx.parse(args.appObjectId).checkHealth().catch(() => ({}))) as { version?: unknown }).version || "")
            : "";
          if (building) {
            pending = `${state.serving.name} serves traffic, but a build is still running: the deployment that follows it is the one to wait for.`;
          } else if (reported && !sameVersion(reported, expected)) {
            pending = `${state.serving.name} serves traffic, but the app still reports Parse Server ${reported}, not ${expected}: a version switch is under way and the new version isn't deployed yet.`;
          } else if (args.version && !reported) {
            pending = `${state.serving.name} serves traffic, but the app doesn't answer its health check yet.`;
          } else {
            return text(
              `${state.serving.name} serves traffic now, ${state.serving.containers} container${state.serving.containers === 1 ? "" : "s"} reporting${reported ? `, and the app reports Parse Server ${reported}` : ""}.`,
            );
          }
        }
        for (const d of state.records || []) {
          if (!known.has(d.objectId)) {
            known.add(d.objectId);
            watched.push(d.objectId);
          }
        }
        const failed = endedBadly(state, watched);
        if (failed) {
          return text(
            `${failed.name} ended: ${failed.phase}. ${state.serving ? `${state.serving.name} still serves traffic. ` : ""}Check get_build_log and get_error_logs.`,
          );
        }
        if (!state.rolling && watched.length === 0 && Date.now() > quietBy) {
          return text(`Nothing is rolling out. ${describeDeploymentState(state)[0]}`);
        }
        if (pending && Date.now() + POLL_MS + POLL_SLACK_MS > deadline) {
          return text(
            `${pending} Not done yet: call wait_for_deployment again with after: ${before}. A version switch builds the app first and takes several minutes.`,
          );
        }
        if (Date.now() + POLL_MS + POLL_SLACK_MS > deadline) {
          return text(
            `${state.rolling ? `Still rolling out: ${state.rolling.name} (${state.rolling.phase}).` : `No newer deployment serves traffic yet${state.serving ? ` (${state.serving.name} still does)` : ""}.`} Deployments usually take one to three minutes: call wait_for_deployment again with after: ${before}.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        state = await deploymentState(client, args.appObjectId);
      }
    },
  );

  server.tool(
    "list_parse_server_versions",
    "The Parse Server versions apps can be created on (create_app) or switched to (change_parse_server_version), newest first.",
    {},
    async () => {
      const versions = await ctx.sashido().listParseServerVersions();
      return text(formatVersions(versions));
    },
  );

  server.tool(
    "change_parse_server_version",
    "Switch an app to another Parse Server version; the app is redeployed. A new major version can break cloud code and clients: read the Parse Server migration guides first. Without confirm: true it only shows what would change.",
    {
      appObjectId: z.string().describe("The application object ID"),
      imageTag: z.string().describe("The version's imageTag, from list_parse_server_versions"),
      confirm: z.boolean().optional().describe("true to switch; otherwise only a preview"),
    },
    async (args) => {
      const client = ctx.sashido();
      const [app, versions] = await Promise.all([findApp(ctx, args.appObjectId), client.listParseServerVersions()]);
      const target = versions.find((v) => v.imageTag === args.imageTag);
      if (!target) {
        return text(`❌ ${args.imageTag} isn't a version apps can use.\n\n${formatVersions(versions)}`);
      }
      if (app.parseServerVersion === target.imageTag) {
        return text(`${app.name} already runs Parse Server ${versionLabel(target.imageTag)}.`);
      }
      const from = app.parseServerVersion;
      const crossesMajor = major(from) !== major(target.imageTag);
      const summary = [
        `${app.name}: Parse Server ${versionLabel(from)} → ${versionLabel(target.imageTag)}`,
        crossesMajor
          ? `This changes the major version (${major(from)} → ${major(target.imageTag)}): cloud code and client SDKs may need changes. Try it on a test app first.`
          : "Same major version.",
        "The app is redeployed; during a deployment without high availability it may be briefly unavailable.",
      ];
      if (!args.confirm) {
        return text(`Preview (nothing changed):\n${summary.join("\n")}\n\nCall again with confirm: true to switch.`);
      }
      const serving = (await deploymentState(client, app.objectId)).serving;
      await client.changeParseServerVersion(app.objectId, target.imageTag);
      return text(
        `✅ Switching.\n${summary.join("\n")}\n\nThe switch builds the app with the new version and then deploys it: several minutes, and a deployment with the old version may serve in between. wait_for_deployment with after: ${serving ? serving.number : 0} waits until the app itself reports Parse Server ${versionParts(target.imageTag).join(".")}; call it again each time it says "not done yet". Until it does, the app's own checks (get_app_advice) may answer with errors: wait, don't report them.`,
      );
    },
  );
}

function formatVersions(versions: ParseServerVersion[]): string {
  const sorted = [...versions].sort((a, b) => compareTags(b.imageTag, a.imageTag));
  return [
    "Parse Server versions (newest first):",
    ...sorted.map((v) => `  ${versionLabel(v.imageTag)} [${v.imageTag}]${v.latest ? " ← default for new apps" : ""}`),
  ].join("\n");
}

function compareTags(a: string, b: string): number {
  const parts = (t: string) => ((/(\d+)\.(\d+)\.(\d+)/.exec(t) || []).slice(1).map(Number));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) {
      return (x[i] || 0) - (y[i] || 0);
    }
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
