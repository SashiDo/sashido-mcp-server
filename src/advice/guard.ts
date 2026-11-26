import type { ToolContext } from "../context.js";
import { schemaChecks } from "./schemaChecks.js";

/**
 * The check before a deploy or a build that the assistant starts: is there
 * something that would hurt the app's users right after it? Only what is
 * critical stops it (a class anyone can write to and delete from). Lesser
 * findings are for get_app_advice, and what is fine is not mentioned: a
 * guard that speaks every time stops being read.
 *
 * It looks at the app's state, not at the code about to be deployed: that
 * arrives by a push to GitHub and is checked elsewhere.
 */
export interface GuardResult {
  /** Set when the action must not go on: what to tell the assistant instead */
  stop?: string;
  /** A line to add to the answer when it does go on */
  note?: string;
}

export async function deployGuard(ctx: ToolContext, appObjectId: string, action: string, anyway?: boolean): Promise<GuardResult> {
  if (ctx.access.scopes.indexOf("data:read") === -1) {
    return { note: "Not checked before this: the token can't read the data model, so whether a class is open to everyone is unknown." };
  }
  let critical;
  try {
    critical = schemaChecks(await ctx.parse(appObjectId).listClasses()).filter((c) => c.state === "fail");
  } catch (e) {
    // a check that can't run must not block a restart of an app in trouble
    return { note: `Not checked before this (${e instanceof Error ? e.message : "the check failed"}).` };
  }
  if (!critical.length) {
    return {};
  }
  const findings = critical.map((c) => `❗ ${c.title}: ${c.message}\n   What to do: ${c.solution ?? "see get_app_advice"}`).join("\n");
  if (anyway) {
    return { note: `Went on although this was found, because deployAnyway was set:\n${findings}` };
  }
  return {
    stop: [
      `Nothing was done: ${action} was not started, because this would hurt the app's users right after it.`,
      "",
      findings,
      "",
      "Tell the person what this means for their app, in plain words, and offer to fix it (update_class_permissions; check get_class_permissions and how the client uses the class first).",
      `If they say to go on as it is, call this again with deployAnyway: true. Never set it without their word.`,
    ].join("\n"),
  };
}
