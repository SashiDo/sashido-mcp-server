import type { AppCheck } from "../client/parse.js";
import { PLATFORM, UpgradeRule } from "../upgrade/rules.js";
import { Finding, byRule } from "../upgrade/scan.js";

const MARK: Record<string, string> = { fail: "❗", warning: "⚠️", error: "⏱️", ok: "✓" };

/** Problems first, each with what to do; the passing ones in one line */
export function formatChecks(checks: Array<AppCheck & { group?: string }>): string[] {
  const order = ["fail", "warning", "error"];
  const problems = checks
    .filter((c) => c.state !== "ok")
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const lines: string[] = [];
  for (const c of problems) {
    lines.push(`${MARK[c.state] || "•"} ${c.title}${c.group ? ` (${c.group})` : ""}: ${c.message}`);
    if (c.solution) {
      lines.push(`   What to do: ${c.solution}`);
    }
  }
  const ok = checks.filter((c) => c.state === "ok");
  if (ok.length) {
    lines.push(`${MARK.ok} Fine: ${ok.map((c) => c.title).join(", ")}.`);
  }
  return lines;
}

export interface UpgradeReport {
  app: string;
  from: string;
  to: string;
  /** the target's imageTag, for create_app */
  toTag: string;
  majors: number[];
  rules: UpgradeRule[];
  findings: Finding[];
  filesScanned: number;
  filesSkipped: string[];
  rollback: string | null;
}

function placesOf(places: Finding[]): string[] {
  const shown = places.slice(0, 8).map((p) => `     ${p.file}:${p.line}  ${p.text}`);
  if (places.length > 8) {
    shown.push(`     … and ${places.length - 8} more`);
  }
  return shown;
}

export function formatUpgrade(r: UpgradeReport): string {
  const groups = byRule(r.findings);
  const breaks = groups.filter((g) => g.rule.severity === "breaks");
  const checks = groups.filter((g) => g.rule.severity === "check");
  const clean = r.rules.filter((rule) => !groups.some((g) => g.rule.id === rule.id));
  const lines = [
    `Upgrade plan for ${r.app}: Parse Server ${r.from} → ${r.to}`,
    r.majors.length ? `Major versions crossed: ${r.majors.join(", ")}.` : "Same major version: no breaking changes expected.",
    `Cloud code scanned: ${r.filesScanned} file${r.filesScanned === 1 ? "" : "s"}${r.filesSkipped.length ? ` (not read: ${r.filesSkipped.join(", ")})` : ""}.`,
    "",
  ];
  if (breaks.length) {
    lines.push("Fix before upgrading (breaks on the new version):");
    for (const g of breaks) {
      lines.push(`❗ ${g.rule.title} (Parse Server ${g.rule.major})`, `   ${g.rule.fix}`, ...placesOf(g.places), `   Source: ${g.rule.source}`);
    }
    lines.push("");
  }
  if (checks.length) {
    lines.push("Check (may behave differently):");
    for (const g of checks) {
      lines.push(`⚠️ ${g.rule.title} (Parse Server ${g.rule.major})`, `   ${g.rule.fix}`, ...placesOf(g.places), `   Source: ${g.rule.source}`);
    }
    lines.push("");
  }
  if (!breaks.length && !checks.length) {
    lines.push("No breaking changes found in the cloud code.", "");
  }
  if (clean.length) {
    lines.push(`Not used in the cloud code: ${clean.map((rule) => rule.title).join("; ")}.`, "");
  }
  const platform = PLATFORM.filter((p) => r.majors.includes(p.major));
  if (platform.length) {
    lines.push("Handled by SashiDo or in App Settings:", ...platform.map((p) => `• Parse Server ${p.major}: ${p.note}`), "");
  }
  lines.push(
    "Plan:",
    `1. ${breaks.length ? "Fix the code above in the app's cloud code (its GitHub repository) and deploy it." : "Nothing in the cloud code has to change first."}`,
    `2. Try it on a test app: create_app with parseServerVersion "${r.toTag}", deploy the same cloud code, test your clients against it.`,
    `3. change_parse_server_version on ${r.app} (it shows a preview first, and refuses when the app's settings need a change first, e.g. Google login client IDs), then wait_for_deployment, check_app_health and get_error_logs.`,
    r.rollback
      ? `4. If something breaks: change_parse_server_version back to "${r.rollback}".`
      : "4. The current version isn't offered anymore, so there is no switching back: test well in step 2.",
  );
  return lines.join("\n");
}
