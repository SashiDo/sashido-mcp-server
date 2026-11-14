import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * What each tool needs and does. A tool is registered only when the access
 * token has its scope, it isn't a change in read-only mode, its group is
 * enabled, and (for local-only tools) the server runs locally over stdio.
 * The API enforces the same scopes; this keeps clients from seeing tools
 * that would only fail.
 */
export type Scope =
  | "account:read"
  | "apps:read"
  | "apps:write"
  | "deploy"
  | "env:read"
  | "env:write"
  | "settings:read"
  | "settings:write"
  | "logs:read"
  | "data:read"
  | "data:write";

/** read: no changes; write: changes; destructive: deletes or overwrites */
export type ToolKind = "read" | "write" | "destructive";

export interface ToolPolicy {
  scope: Scope;
  kind: ToolKind;
  /** Reads local files or fetches URLs: only on the user's own machine */
  localOnly?: boolean;
  /** Needs a token for all apps: one limited to some can't, e.g., add apps */
  allApps?: boolean;
}

const read = (scope: Scope): ToolPolicy => ({ scope, kind: "read" });
const write = (scope: Scope): ToolPolicy => ({ scope, kind: "write" });
const destructive = (scope: Scope): ToolPolicy => ({
  scope,
  kind: "destructive",
});

export const TOOL_POLICY: Record<string, ToolPolicy> = {
  // apps
  list_apps: read("account:read"),
  // audit log: the account's activity
  get_audit_log: read("account:read"),
  get_app: read("account:read"),
  create_app: { ...write("apps:write"), allApps: true },
  update_app_name: write("apps:write"),
  // builds and deployments
  list_builds: read("apps:read"),
  get_build_log: read("apps:read"),
  trigger_build: write("deploy"),
  cancel_build: write("deploy"),
  deploy_app: write("deploy"),
  cancel_deployment: write("deploy"),
  get_deployment_info: read("apps:read"),
  // infrastructure: what runs an app, versions
  get_app_infrastructure: read("account:read"),
  wait_for_deployment: read("apps:read"),
  list_parse_server_versions: read("apps:read"),
  // a new major version can break cloud code and clients
  change_parse_server_version: destructive("apps:write"),
  // engines, scale and health
  list_engines: read("apps:read"),
  set_engine: write("apps:write"),
  scale_app: write("apps:write"),
  set_high_availability: write("apps:write"),
  check_app_health: read("apps:read"),
  // environment variables
  list_env_vars: read("env:read"),
  set_env_var: write("env:write"),
  delete_env_var: destructive("env:write"),
  // App Settings: login methods, email, push, Live Queries, custom domain
  get_app_settings: read("settings:read"),
  update_app_settings: write("settings:write"),
  get_custom_domain: read("settings:read"),
  set_custom_domain: write("settings:write"),
  remove_custom_domain: destructive("settings:write"),
  // classes (schema)
  list_classes: read("data:read"),
  generate_types: read("data:read"),
  // advisor: checks and upgrade plans, read only
  get_app_advice: read("data:read"),
  plan_parse_server_upgrade: read("data:read"),
  get_class: read("data:read"),
  get_class_permissions: read("data:read"),
  create_class: write("data:write"),
  add_field: write("data:write"),
  update_class_permissions: write("data:write"),
  delete_field: destructive("data:write"),
  delete_class: destructive("data:write"),
  // objects
  query_objects: read("data:read"),
  get_object: read("data:read"),
  create_object: write("data:write"),
  update_object: write("data:write"),
  delete_object: destructive("data:write"),
  // files
  upload_file: write("data:write"),
  upload_file_from_url: { ...write("data:write"), localOnly: true },
  upload_file_from_path: { ...write("data:write"), localOnly: true },
  // cloud code
  call_cloud_function: write("data:write"),
  list_cloud_files: read("data:read"),
  read_cloud_code: read("data:read"),
  // push
  send_push: write("data:write"),
  send_push_to_channels: write("data:write"),
  get_push_status: read("data:read"),
  list_audiences: read("data:read"),
  list_available_devices: read("data:read"),
  create_audience: write("data:write"),
  delete_audience: destructive("data:write"),
  // jobs
  list_available_jobs: read("data:read"),
  list_scheduled_jobs: read("data:read"),
  get_job_status: read("data:read"),
  schedule_job: write("data:write"),
  run_job: write("data:write"),
  delete_job: destructive("data:write"),
  // logs
  get_logs: read("logs:read"),
  get_error_logs: read("logs:read"),
  // webhooks
  list_function_webhooks: read("data:read"),
  get_function_webhook: read("data:read"),
  create_function_webhook: write("data:write"),
  update_function_webhook: write("data:write"),
  delete_function_webhook: destructive("data:write"),
  list_trigger_webhooks: read("data:read"),
  get_trigger_webhook: read("data:read"),
  create_trigger_webhook: write("data:write"),
  update_trigger_webhook: write("data:write"),
  delete_trigger_webhook: destructive("data:write"),
};

/** Tool groups for the `features` option: the folders under src/tools */
export type ToolGroup = string;

export interface Access {
  /** Scopes of the access token */
  scopes: string[];
  /** null: every app the token may use */
  appIds: string[] | null;
  /** Register only tools that change nothing */
  readOnly: boolean;
  /** null: every group */
  groups: ToolGroup[] | null;
  /** stdio: local files and URLs may be read */
  local: boolean;
}

export function isToolAllowed(
  name: string,
  group: ToolGroup,
  access: Access,
): boolean {
  const policy = TOOL_POLICY[name];
  if (!policy) {
    // every tool must be listed above; failing closed keeps a forgotten
    // tool from being exposed with unknown access
    return false;
  }
  if (access.scopes.indexOf(policy.scope) === -1) {
    return false;
  }
  if (access.readOnly && policy.kind !== "read") {
    return false;
  }
  if (policy.localOnly && !access.local) {
    return false;
  }
  if (policy.allApps && access.appIds) {
    return false;
  }
  if (access.groups && access.groups.indexOf(group) === -1) {
    return false;
  }
  return true;
}

/** MCP annotations, so clients can ask before changes and deletions */
export function annotationsFor(name: string): ToolAnnotations {
  const policy = TOOL_POLICY[name];
  if (!policy) {
    throw new Error(`Tool ${name} has no access policy`);
  }
  return {
    readOnlyHint: policy.kind === "read",
    destructiveHint: policy.kind === "destructive",
    // these act on SashiDo, not on an open-ended world
    openWorldHint: false,
  };
}

/**
 * Options a client adds to the MCP URL (or env vars locally). They can only
 * narrow what the token allows: ?read_only=true&apps=id1,id2&features=objects,logs
 */
export function narrowAccess(
  base: Access,
  options: { readOnly?: string; apps?: string; features?: string },
): Access {
  const list = (value?: string) =>
    value
      ? value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : null;

  const apps = list(options.apps);
  let appIds = base.appIds;
  if (apps) {
    appIds = base.appIds ? apps.filter((id) => base.appIds!.indexOf(id) !== -1) : apps;
  }

  return {
    ...base,
    readOnly: base.readOnly || options.readOnly === "true" || options.readOnly === "1",
    appIds,
    groups: list(options.features) || base.groups,
  };
}
