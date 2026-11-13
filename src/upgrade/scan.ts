import { RULES, UpgradeRule } from "./rules.js";

export interface Finding {
  rule: UpgradeRule;
  file: string;
  /** 1-based */
  line: number;
  text: string;
}

/** The rules for an upgrade from one major version to another */
export function rulesFor(fromMajor: number, toMajor: number): UpgradeRule[] {
  return RULES.filter((r) => r.major > fromMajor && r.major <= toMajor);
}

// a line that is only a comment (or inside a block comment) says nothing
function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

/** Where a cloud code file uses what the upgrade breaks */
export function scanFile(file: string, content: string, rules: UpgradeRule[]): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");
  // the stage names only matter in aggregation pipelines
  const aggregates = /\.aggregate\s*\(/.test(content);
  for (const rule of rules) {
    if (rule.id === "aggregate-syntax" && !aggregates) {
      continue;
    }
    lines.forEach((line, i) => {
      if (!isComment(line) && rule.pattern.test(line)) {
        findings.push({ rule, file, line: i + 1, text: line.trim().slice(0, 140) });
      }
    });
  }
  return findings;
}

/** Findings by rule, the rules that break first */
export function byRule(findings: Finding[]): Array<{ rule: UpgradeRule; places: Finding[] }> {
  const groups = new Map<string, { rule: UpgradeRule; places: Finding[] }>();
  for (const f of findings) {
    const group = groups.get(f.rule.id) || { rule: f.rule, places: [] };
    group.places.push(f);
    groups.set(f.rule.id, group);
  }
  return [...groups.values()].sort(
    (a, b) => (a.rule.severity === b.rule.severity ? a.rule.major - b.rule.major : a.rule.severity === "breaks" ? -1 : 1),
  );
}
