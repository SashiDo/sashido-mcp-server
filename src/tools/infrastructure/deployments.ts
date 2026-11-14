import { Deployment, DeploymentHistoryEntry, SashidoClient } from "../../client/sashido.js";

// Two numberings, never compared with each other:
// - what serves traffic: the app's running instances, as they report now
// - the deployment history the dashboard shows, with its own numbering;
//   cancel_deployment takes these names. It lists what the customer's team
//   started (with what and who), not the platform's own rollouts, so it
//   never decides what serves.

export const IN_PROGRESS = ["New", "Pending", "Running"];
const ENDED_BADLY = ["Failed", "Cancelled", "Error"];
// a record still "in progress" after this is stuck, not rolling out
const STUCK_AFTER_MS = 30 * 60 * 1000;

export interface DeploymentState {
  /** The deployment whose containers report now */
  serving: { name: string; number: number; containers: number } | null;
  /** The deployment history, newest first; null when it can't be read */
  records: DeploymentHistoryEntry[] | null;
  /** In progress in the history, recently started: can be cancelled */
  rolling: Deployment | null;
  /** "In progress" in the history for too long: never ended there */
  stuck: Deployment[];
}

// how long deploy_app looks for the new deployment in the history (tests
// make it short)
const RECORD_POLL_MS = Number(process.env.SASHIDO_POLL_MS) || 1500;
const RECORD_POLLS = 4;

/** The history's record of a deployment started after `before`, if any */
export async function newRecord(
  client: SashidoClient,
  appObjectId: string,
  before: DeploymentState,
): Promise<Deployment | null> {
  const known = new Set((before.records || []).map((d) => d.objectId));
  for (let i = 0; i < RECORD_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, RECORD_POLL_MS));
    const records = await client.listDeployments(appObjectId, 5).catch(() => null);
    const found = (records || []).find((d) => !known.has(d.objectId));
    if (found) {
      return found;
    }
  }
  return null;
}

const age = (d: Deployment) => Date.now() - Date.parse(d.createdAt);

export async function deploymentState(client: SashidoClient, appObjectId: string): Promise<DeploymentState> {
  const [live, history] = await Promise.all([
    client.getActiveDeployment(appObjectId).catch(() => null),
    client.getDeploymentHistory(appObjectId, 5).catch(() => null),
  ]);
  // the history says what and who; until the API has it, the plain records
  const records: DeploymentHistoryEntry[] | null =
    history || (await client.listDeployments(appObjectId, 5).catch(() => null));
  const serving =
    live && live.deploymentName && live.deploymentNumber !== null
      ? {
          name: live.deploymentName,
          number: live.deploymentNumber,
          containers: Object.keys(live.processes || {}).length,
        }
      : null;
  const inProgress = (records || []).filter((d) => IN_PROGRESS.includes(d.phase));
  return {
    serving,
    records,
    rolling: inProgress.find((d) => age(d) < STUCK_AFTER_MS) || null,
    stuck: inProgress.filter((d) => age(d) >= STUCK_AFTER_MS),
  };
}

/** Of the records in progress before, one that ended badly since */
export function endedBadly(state: DeploymentState, watched: string[]): Deployment | null {
  return (state.records || []).find((d) => watched.includes(d.objectId) && ENDED_BADLY.includes(d.phase)) || null;
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60000))} min`;

export function describeDeploymentState(state: DeploymentState): string[] {
  const lines = [
    state.serving
      ? `Serving traffic: ${state.serving.name}, ${state.serving.containers} container${state.serving.containers === 1 ? "" : "s"} reporting.`
      : "Serving traffic: no containers report now (the app may be stopped, or just being deployed).",
  ];
  if (!state.records) {
    return lines;
  }
  if (state.rolling) {
    lines.push(
      `Rolling out: ${state.rolling.name}, ${state.rolling.phase} for ${minutes(age(state.rolling))}. wait_for_deployment waits for it; cancel_deployment with deploymentName="${state.rolling.name}" stops it.`,
    );
  } else {
    lines.push("No deployment in the history is rolling out.");
  }
  for (const d of state.stuck) {
    lines.push(`${d.name} shows ${d.phase} for ${minutes(age(d))}: it never ended in the history (not rolling out).`);
  }
  if (state.records.length) {
    lines.push(
      "Deployment history (the dashboard's numbering; what your team started):",
      ...state.records.map((d) => {
        const what = describeCause(d);
        return `  ${d.name}: ${d.phase}, ${d.createdAt.replace("T", " ").slice(0, 16)}${what ? ` — ${what}` : ""}`;
      }),
    );
  }
  return lines;
}

const REASONS: Record<string, string> = {
  settings: "Settings",
  env: "Environment variables",
  domain: "Custom domain",
  push_certificate: "Push certificate",
  engine: "Engine",
  high_availability: "High availability",
  version: "Parse Server version",
  manual: "Start Deploy",
};
const MAX_CHANGES = 3;
const MAX_TEXT = 100;

// Text that comes from outside (a commit message, a token's name, a client's
// label): one line, no control characters, short. It goes to an AI assistant
// as data, so it mustn't be able to pass for lines of its own.
function plain(text: unknown): string {
  const line = (String(text || "").split(/\r?\n/)[0] || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .trim();
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
}

/** "Settings: PARSE_SERVER_LIVE_QUERY_OPTIONS (none → Test), by me@example.com via Dashboard" */
export function describeCause(d: DeploymentHistoryEntry): string {
  const parts: string[] = [];
  const cause = d.cause;
  if (cause && cause.kind === "build") {
    const b = cause.build || {};
    parts.push(
      [b.number ? `build #${b.number}` : "a build", b.source === "GitHub" ? "GitHub push" : "", b.message ? `commit message "${plain(b.message)}"` : ""]
        .filter(Boolean)
        .join(", "),
    );
  } else if (cause) {
    const changes = (cause.changes || []).slice(0, MAX_CHANGES).map((c) =>
      c.from !== undefined && c.to !== undefined
        ? `${plain(c.name)} (${plain(c.from)} → ${plain(c.to)})`
        : `${plain(c.name)} ${plain(c.change)}`,
    );
    const more = (cause.changes || []).length - changes.length;
    const what = REASONS[cause.kind] || cause.kind;
    parts.push(changes.length ? `${what}: ${changes.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : what);
  }
  const by = d.startedBy;
  if (by) {
    const who = [by.user && plain(by.user.name || by.user.email), by.tokenName && `token "${plain(by.tokenName)}"`]
      .filter(Boolean)
      .join(", ");
    const via = by.client === "dashboard" ? "Dashboard" : by.client === "github" ? "GitHub" : by.client.startsWith("mcp") ? "MCP" : "API";
    parts.push(`${who ? `by ${who} ` : ""}via ${via}${by.ip ? ` from ${by.ip}` : ""}`);
  }
  return parts.join(", ");
}
