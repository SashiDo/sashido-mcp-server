import { z } from "zod";
import { ToolContext, ToolServer } from "../../context.js";
import type { AppCheck, ParseClient } from "../../client/parse.js";
import { schemaChecks } from "../../advice/schemaChecks.js";
import { formatChecks, formatUpgrade } from "../../advice/format.js";
import { Finding, byRule, rulesFor, scanFile } from "../../upgrade/scan.js";
import { UpgradeRule, majorsCrossed } from "../../upgrade/rules.js";
import { compareVersions, hasAppChecks, isOutdated, versionParts } from "../../upgrade/versions.js";
import { versionLabel } from "../infrastructure/index.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const CODE_FILE = /\.(m?js|cjs|ts)$/;
const MAX_FILES = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

async function appVersion(ctx: ToolContext, appObjectId: string) {
  const app = (await ctx.sashido().listApps()).find((a) => a.objectId === appObjectId);
  if (!app) {
    throw new Error(`App ${appObjectId} not found.`);
  }
  return { name: app.name, version: app.parseServerVersion };
}

/** Scans the app's cloud code files with the rules: findings, files read and not */
async function scanCloudCode(parse: ParseClient, rules: UpgradeRule[]) {
  const files = (await parse.listCloudCodeFiles()).cloudFiles
    .map((f) => f.path)
    .filter((path) => CODE_FILE.test(path) && path.indexOf("node_modules/") === -1);
  const findings: Finding[] = [];
  const skipped: string[] = files.slice(MAX_FILES);
  let scanned = 0;
  for (const path of files.slice(0, MAX_FILES)) {
    try {
      findings.push(...scanFile(path, await parse.readCloudCodeFile(path), rules));
      scanned++;
    } catch {
      skipped.push(path);
    }
  }
  return { findings, scanned, skipped };
}

// a part of the advice that can't be done (e.g. a scope the token lacks)
// is said, not fatal
async function part(lines: string[], title: string, work: () => Promise<string[]>) {
  try {
    lines.push(`${title}:`, ...(await work()), "");
  } catch (e) {
    lines.push(`${title}: skipped (${e instanceof Error ? e.message : "failed"}).`, "");
  }
}

export function registerAdvisorTools(server: ToolServer, ctx: ToolContext): void {
  server.tool(
    "get_app_advice",
    "Check an app for what to fix: security (class-level permissions, client push, class creation, social logins), users and sessions, the database (Parse Server 6.5.11+ runs its own checks; older versions get the schema checks), its Parse Server version, health, recent errors and failed jobs. Each problem comes with what to do.",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args) => {
      const { name, version } = await appVersion(ctx, args.appObjectId);
      const parse = ctx.parse(args.appObjectId);
      const lines = [`Advice for ${name} (Parse Server ${versionLabel(version)})`, ""];

      if (isOutdated(version)) {
        // what is offered now, not what is announced
        const versions = await ctx.sashido().listParseServerVersions().catch(() => []);
        const newest = [...versions].sort((a, b) => compareVersions(b.imageTag, a.imageTag))[0];
        lines.push(
          `⚠️ Parse Server ${versionLabel(version)} is an older major version${newest ? `; ${versionLabel(newest.imageTag)} is available` : ""}, with security fixes and a current Node.js. plan_parse_server_upgrade shows what the cloud code needs.`,
          "",
        );
      }

      await part(lines, "Security and data", async () => {
        if (hasAppChecks(version)) {
          const report = await parse.getAppChecks();
          const checks: Array<AppCheck & { group?: string }> = [];
          report.groups.forEach((g) => g.checks.forEach((c) => checks.push({ ...c, group: g.name })));
          return formatChecks(checks);
        }
        const checks = schemaChecks(await parse.listClasses());
        return [
          ...formatChecks(checks),
          "(Parse Server 6.5.11+ also checks client push, class creation, social logins, users and sessions, and the database.)",
        ];
      });

      // code written for an older major than the app runs (e.g. 2.x code on 6)
      const major = versionParts(version)[0];
      if (major > 0) {
        await part(lines, "Cloud code", async () => {
          const rules = rulesFor(0, major).filter((r) => r.severity === "breaks");
          const { findings, scanned } = await scanCloudCode(parse, rules);
          if (!findings.length) {
            return [`✓ ${scanned} file${scanned === 1 ? "" : "s"} read: nothing that stopped working by Parse Server ${major}.`];
          }
          const out: string[] = [];
          for (const g of byRule(findings)) {
            out.push(
              `❗ ${g.rule.title}: stopped working in Parse Server ${g.rule.major}; this app runs ${versionLabel(version)}.`,
              `   What to do: ${g.rule.fix}`,
            );
            out.push(...g.places.slice(0, 6).map((p) => `     ${p.file}:${p.line}  ${p.text}`));
            if (g.places.length > 6) {
              out.push(`     … and ${g.places.length - 6} more`);
            }
          }
          return out;
        });
      }

      await part(lines, "Running", async () => {
        const out: string[] = [];
        const health = await parse.checkHealth().catch((e: Error) => ({ status: `unreachable: ${e.message}` }));
        out.push(health.status === "ok" ? "✓ The app server answers its health check." : `❗ Health check: ${health.status}.`);
        if (ctx.access.scopes.indexOf("logs:read") !== -1) {
          const errors = await parse.getLogs({ level: "error", limit: 100 });
          const recent = errors.filter((e) => Date.now() - Date.parse(e.timestamp) < DAY_MS);
          out.push(
            recent.length
              ? `⚠️ ${recent.length} error${recent.length === 1 ? "" : "s"} in the last 24 hours: get_error_logs shows them.`
              : "✓ No errors in the cloud code logs in the last 24 hours.",
          );
        }
        const runs = await parse.getJobStatus(20).catch(() => []);
        const failed = runs.filter((r) => r.status === "failed");
        if (failed.length) {
          out.push(`⚠️ ${failed.length} of the last ${runs.length} job runs failed: ${[...new Set(failed.map((r) => r.jobName))].join(", ")} (get_job_status).`);
        } else if (runs.length) {
          out.push(`✓ The last ${runs.length} job runs didn't fail.`);
        }
        return out;
      });

      return text(lines.join("\n").trim());
    },
  );

  server.tool(
    "plan_parse_server_upgrade",
    "Plan an app's move to a newer Parse Server version (e.g. to 6 or 8): which of its cloud code breaks, where (file and line), how to change it, with sources from Parse Server's migration guides; what SashiDo handles; and the steps, with a way back. Reads the cloud code, changes nothing.",
    {
      appObjectId: z.string().describe("The application object ID"),
      imageTag: z.string().optional().describe("The target version's imageTag (list_parse_server_versions); default: the newest"),
    },
    async (args) => {
      const { name, version } = await appVersion(ctx, args.appObjectId);
      const versions = await ctx.sashido().listParseServerVersions();
      const newest = [...versions].sort((a, b) => compareVersions(b.imageTag, a.imageTag))[0];
      const target = args.imageTag ? versions.find((v) => v.imageTag === args.imageTag) : newest;
      if (!target) {
        return text(`❌ ${args.imageTag} isn't a version apps can use: list_parse_server_versions shows them.`);
      }
      if (version && compareVersions(target.imageTag, version) <= 0) {
        return text(`${name} already runs Parse Server ${versionLabel(version)}, not older than ${versionLabel(target.imageTag)}.`);
      }
      const from = versionParts(version)[0];
      const to = versionParts(target.imageTag)[0];
      const rules = rulesFor(from, to);

      const { findings, scanned, skipped } = await scanCloudCode(ctx.parse(args.appObjectId), rules);

      return text(
        formatUpgrade({
          app: name,
          from: versionLabel(version),
          to: versionLabel(target.imageTag),
          toTag: target.imageTag,
          majors: majorsCrossed(from, to),
          rules,
          findings,
          filesScanned: scanned,
          filesSkipped: skipped,
          rollback: version && versions.some((v) => v.imageTag === version) ? version : null,
        }),
      );
    },
  );
}
