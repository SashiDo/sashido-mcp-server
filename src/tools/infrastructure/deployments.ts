import { Deployment, SashidoClient } from "../../client/sashido.js";

// Two numberings, never compared with each other:
// - what serves traffic: the app's running instances, as they report now
// - the deployment history the dashboard shows, with its own numbering;
//   cancel_deployment takes these names. Not every rollout appears in it,
//   so it never decides what serves.

export const IN_PROGRESS = ["New", "Pending", "Running"];
const ENDED_BADLY = ["Failed", "Cancelled", "Error"];
// a record still "in progress" after this is stuck, not rolling out
const STUCK_AFTER_MS = 30 * 60 * 1000;

export interface DeploymentState {
  /** The deployment whose containers report now */
  serving: { name: string; number: number; containers: number } | null;
  /** The deployment history, newest first; null when it can't be read */
  records: Deployment[] | null;
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
  const [live, records] = await Promise.all([
    client.getActiveDeployment(appObjectId).catch(() => null),
    client.listDeployments(appObjectId, 5).catch(() => null),
  ]);
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
      "Deployment history (the dashboard's numbering, which may miss some deployments):",
      ...state.records.map((d) => `  ${d.name}: ${d.phase}, ${d.createdAt.replace("T", " ").slice(0, 16)}`),
    );
  }
  return lines;
}
