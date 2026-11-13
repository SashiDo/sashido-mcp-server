/** "release-6.5.11-ubi8-node18" -> [6, 5, 11]; [0, 0, 0] when unknown */
export function versionParts(tag?: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(tag || "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

export function compareVersions(a?: string, b?: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) {
      return x[i]! - y[i]!;
    }
  }
  return 0;
}

/** The app servers' own checks (GET /app_checks) exist from 6.5.11 */
export function hasAppChecks(tag?: string): boolean {
  return compareVersions(tag, "6.5.11") >= 0;
}

/** Parse Server majors that no longer get updates upstream */
export function isOutdated(tag?: string): boolean {
  const major = versionParts(tag)[0];
  return major > 0 && major < 6;
}
