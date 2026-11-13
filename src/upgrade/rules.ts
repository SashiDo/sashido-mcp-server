/**
 * What breaks in an app's cloud code between Parse Server major versions,
 * from Parse Server's own migration guides and changelogs (sources below):
 * only what concerns the code customers write. What SashiDo runs for them
 * (Node.js, MongoDB, how the server starts, masterKeyIps) is in PLATFORM.
 */

const GUIDE_3 = "https://github.com/parse-community/parse-server/blob/3.0.0/3.0.0.md";
const CHANGES = "https://github.com/parse-community/parse-server/blob/alpha/changelogs/CHANGELOG_release.md";

export interface UpgradeRule {
  id: string;
  /** The major version that breaks it */
  major: number;
  title: string;
  /** Found in a cloud code file, line by line */
  pattern: RegExp;
  /** breaks: fix before upgrading; check: may change behaviour */
  severity: "breaks" | "check";
  fix: string;
  source: string;
}

export const RULES: UpgradeRule[] = [
  {
    id: "response-success",
    major: 3,
    title: "response.success / response.error in functions and triggers",
    pattern: /\bresponse\.(success|error)\s*\(/,
    severity: "breaks",
    fix: "Handlers take only the request: return the result (or nothing) instead of response.success, throw instead of response.error. A beforeSave that never returns or throws no longer hangs; it saves.",
    source: GUIDE_3,
  },
  {
    id: "job-status",
    major: 3,
    title: "status.success / status.error / status.message in jobs",
    pattern: /\bstatus\.(success|error|message)\s*\(/,
    severity: "breaks",
    fix: "Jobs have no status object: use request.message(...) for progress, return (or resolve) when done, throw to fail. Jobs that wait for status.success never finish on Parse Server 3+.",
    source: GUIDE_3,
  },
  {
    id: "backbone-callbacks",
    major: 3,
    title: "{ success, error } callbacks",
    pattern: /\b(success|error)\s*:\s*(function\b|\(|[A-Za-z_$][\w$]*\s*=>)/,
    severity: "breaks",
    fix: "Cloud code runs with the Parse JS SDK 2+, which has no callback options: use the returned promises (await query.find(), await object.save()).",
    source: GUIDE_3,
  },
  {
    id: "parse-promise",
    major: 3,
    title: "Parse.Promise",
    pattern: /\bParse\.Promise\b/,
    severity: "breaks",
    fix: "Parse.Promise is gone with the Parse JS SDK 2: use native Promise (Promise.all, Promise.resolve, async/await).",
    source: GUIDE_3,
  },
  {
    id: "http-request",
    major: 6,
    title: "Parse.Cloud.httpRequest",
    pattern: /\bParse\.Cloud\.httpRequest\s*\(/,
    severity: "breaks",
    fix: "Removed in Parse Server 6: use an HTTP library (e.g. axios, added to the cloud code's package.json) or Node's https.",
    source: CHANGES,
  },
  {
    id: "aggregate-syntax",
    major: 6,
    title: "Aggregation pipeline stages without $",
    pattern: /(^|[{,\s])(match|group|project|lookup|unwind|sort|limit|skip|count|sample)\s*:/,
    severity: "check",
    fix: "From Parse Server 6 aggregate pipelines use MongoDB's syntax: stages with a leading $ ($match, $group, ...) and the document id as _id, not objectId. Only applies where this is an aggregation pipeline.",
    source: CHANGES,
  },
  {
    id: "internal-fields",
    major: 6,
    title: "Reading internal _ fields of users",
    pattern: /['"]_(hashed_password|email_verify_token|perishable_token|failed_login_count|account_lockout_expires_at|password_history|password_changed_at|email_verify_token_expires_at|perishable_token_expires_at)['"]/,
    severity: "breaks",
    fix: "From Parse Server 6 the master key no longer reads Parse Server's internal fields (prefixed with _); they need the maintenance key. Don't depend on them in cloud code.",
    source: CHANGES,
  },
  {
    id: "after-login-throw",
    major: 6,
    title: "Errors thrown in afterLogin / afterLogout",
    pattern: /\bParse\.Cloud\.after(Login|Logout)\s*\(/,
    severity: "check",
    fix: "From Parse Server 6 an error thrown in afterLogin or afterLogout rejects the request instead of crashing the server; make sure these triggers only throw when the login should fail.",
    source: CHANGES,
  },
  {
    id: "private-users",
    major: 6,
    title: "Queries of other users",
    pattern: /new\s+Parse\.Query\(\s*(Parse\.User|["']_User["'])/,
    severity: "check",
    fix: "Parse Server 6 turns on enforcePrivateUsers: new users are saved readable only by themselves. Queries of other users without the master key find fewer users; use { useMasterKey: true } in cloud code where that is intended.",
    source: CHANGES,
  },
  {
    id: "file-triggers",
    major: 7,
    title: "File triggers (beforeSaveFile, afterDeleteFile, ...)",
    pattern: /\bParse\.Cloud\.(before|after)(Save|Delete|Find)File\s*\(/,
    severity: "breaks",
    fix: "From Parse Server 7 file triggers use the object trigger syntax: Parse.Cloud.beforeSave(Parse.File, (request) => {...}) instead of Parse.Cloud.beforeSaveFile(...).",
    source: CHANGES,
  },
  {
    id: "session-current",
    major: 7,
    title: "Parse.Session.current()",
    pattern: /\bParse\.Session\.current\s*\(/,
    severity: "check",
    fix: "From Parse Server 7 Parse.Session.current() returns an expired session (with its expiresAt) instead of throwing: check expiresAt where it matters.",
    source: CHANGES,
  },
  {
    id: "encode-parse-objects",
    major: 8,
    title: "Cloud functions returning Parse objects",
    pattern: /\bParse\.Cloud\.define\s*\(/,
    severity: "check",
    fix: "From Parse Server 8 (encodeParseObjectInCloudFunction) Parse objects a cloud function returns reach the clients as Parse objects, not plain JSON. Clients that read the result as JSON (e.g. result.name instead of result.get('name')) need a change, or return object.toJSON().",
    source: CHANGES,
  },
];

/** What changes with a major version but SashiDo runs: nothing to do */
export const PLATFORM: Array<{ major: number; note: string }> = [
  { major: 6, note: "Node.js, MongoDB, how Parse Server starts, masterKeyIps and trustProxy: set by SashiDo." },
  { major: 7, note: "Social logins are turned on per provider in App Settings > Users; Node.js 18+." },
  { major: 8, note: "Email verification and password reset links no longer carry the username: check customized email templates and pages in App Settings. Node.js 18+, MongoDB 6+: set by SashiDo." },
];

/** Majors an upgrade crosses: from 3.6.0 to 8.x: 4..8 */
export function majorsCrossed(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = from + 1; m <= to; m++) {
    out.push(m);
  }
  return out;
}
