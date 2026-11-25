<p align="center">
  <img src="https://dka575ofm4ao0.cloudfront.net/pages-transactional_logos/retina/27162/FDedZYhLRraWlTG8tqDP" alt="SashiDo Logo" width="200"/>
</p>

<h1 align="center">SashiDo MCP Server</h1>

<p align="center">
  <strong>Manage your SashiDo Parse Server apps from Claude, Cursor, VS Code and any MCP client</strong>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg" alt="Node.js Version"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Compatible-purple.svg" alt="MCP Compatible"></a>
</p>

---

A [Model Context Protocol](https://modelcontextprotocol.io/) server for [SashiDo](https://www.sashido.io). An AI assistant connected to it can work with your apps the way you do in the dashboard: read the schema and data, deploy, scale, read logs, send push notifications, run jobs, check an app for security problems and plan a Parse Server upgrade.

It acts with a **personal access token** that you create in the dashboard, with only the permissions you choose. Every call is recorded in your account's Activity.

## Connect

### 1. Create an access token

In the [SashiDo Dashboard](https://dashboard.sashido.io) open **Account › Access Tokens** and create a token. Choose:

- **Scopes**: what the token may do. *Read-only* is the safe choice to start with.
- **Apps**: all apps, or only some.
- **Expiry**: optional.

The dashboard shows ready configurations for the clients below.

### 2. Add the server to your client

The hosted server is at **`https://mcp.sashido.io/mcp`** (Streamable HTTP), with `https://mcp.sashido.io/sse` for clients that only speak SSE. The token goes in the `Authorization` header.

**Claude Code**

```bash
claude mcp add --transport http sashido https://mcp.sashido.io/mcp \
  --header "Authorization: Bearer sashido_pat_..."
```

**Cursor** (`~/.cursor/mcp.json`) and other clients with remote servers

```json
{
  "mcpServers": {
    "sashido": {
      "url": "https://mcp.sashido.io/mcp",
      "headers": { "Authorization": "Bearer sashido_pat_..." }
    }
  }
}
```

**Claude Desktop** and clients that run local servers (stdio)

```json
{
  "mcpServers": {
    "sashido": {
      "command": "npx",
      "args": ["-y", "@sashido/mcp-server"],
      "env": { "SASHIDO_ACCESS_TOKEN": "sashido_pat_..." }
    }
  }
}
```

The local server also has the tools that read your files or fetch URLs (`upload_file_from_path`, `upload_file_from_url`). The hosted one doesn't.

### Narrowing a connection

A connection can do less than its token allows. Over HTTP, add options to the URL. Over stdio, set the matching environment variables.

| URL option | stdio variable | Effect |
|---|---|---|
| `read_only=true` | `SASHIDO_READ_ONLY=true` | Only tools that change nothing |
| `apps=id1,id2` | `SASHIDO_APPS=id1,id2` | Only these apps |
| `features=objects,logs` | `SASHIDO_FEATURES=objects,logs` | Only these tool groups (see below) |

For example: `https://mcp.sashido.io/mcp?read_only=true&apps=AbC123`

## Scopes

| Scope | Allows |
|---|---|
| `account:read` | List apps, read the Activity (audit log), see an app's infrastructure |
| `apps:read` | Builds, deployments, engines, health, Parse Server versions |
| `apps:write` | Create and rename apps, change engines, scale, high availability, Parse Server version |
| `deploy` | Build, deploy and cancel |
| `env:read` / `env:write` | Environment variables |
| `settings:read` / `settings:write` | App settings (login methods, multi-factor authentication, email, push, Live Queries, API options) and the custom domain. Secrets can be set, never read |
| `logs:read` | Logs |
| `data:read` | Schema, objects, cloud code, push status, jobs, webhooks, advisor |
| `data:write` | Change data and schema, call functions, send push, run jobs, webhooks |

A client only sees the tools its token and options allow. The SashiDo API checks the same scopes again on every call.

## Tools

77 tools in these groups (the names are what `features` takes):

| Group | Tools |
|---|---|
| `apps` | `list_apps`, `get_app`, `create_app`, `update_app_name` |
| `audit` | `get_audit_log`: who did what and through which client (dashboard, API, MCP) |
| `builds` | `list_builds`, `get_build_log`, `trigger_build`, `cancel_build` |
| `deployments` | `get_deployment_info`, `deploy_app`, `cancel_deployment` |
| `infrastructure` | `get_app_infrastructure`, `wait_for_deployment`, `list_parse_server_versions`, `change_parse_server_version` |
| `engines` | `list_engines`, `set_engine`, `scale_app`, `set_high_availability` |
| `health` | `check_app_health` |
| `metrics` | `get_process_metrics`: CPU, memory, event loop lag and restarts over time, what each engine uses against its limits, and what stands out with what to do about it |
| `env` | `list_env_vars`, `set_env_var`, `delete_env_var` |
| `settings` | `get_app_settings`, `update_app_settings`, `get_custom_domain`, `set_custom_domain`, `remove_custom_domain` |
| `classes` | `list_classes`, `get_class`, `get_class_permissions`, `create_class`, `add_field`, `update_class_permissions`, `delete_field`, `delete_class` |
| `types` | `generate_types`: typed classes from the schema for TypeScript, Swift, Kotlin and Dart |
| `advisor` | `get_app_advice`: security, data, cloud code and runtime checks, each with what to do; `plan_parse_server_upgrade`: what breaks in your cloud code on a newer version, where, and how to fix it |
| `objects` | `query_objects`, `get_object`, `create_object`, `update_object`, `delete_object` |
| `files` | `upload_file`, `upload_file_from_url`*, `upload_file_from_path`* |
| `cloud-functions` | `call_cloud_function`, `list_cloud_files`, `read_cloud_code` |
| `push` | `send_push`, `send_push_to_channels`, `get_push_status`, `list_audiences`, `create_audience`, `delete_audience`, `list_available_devices` |
| `jobs` | `list_available_jobs`, `list_scheduled_jobs`, `get_job_status`, `schedule_job`, `run_job`, `delete_job` |
| `logs` | `get_logs`, `get_error_logs` |
| `webhooks` | `list_/get_/create_/update_/delete_function_webhook`, `list_/get_/create_/update_/delete_trigger_webhook` |

\* local (stdio) only.

Tools carry MCP annotations (read-only, destructive, idempotent), so clients can ask before a change. Changes that are hard to undo, such as `change_parse_server_version`, show a preview first.

Things to ask:

- *"Check my-app for security problems and tell me what to fix."*
- *"What breaks in my cloud code if I move to Parse Server 6?"*
- *"Generate TypeScript types for my classes."*
- *"Deploy my-app and tell me when it's live."*
- *"Show the errors from the last hour."*
- *"Who changed my-app's environment variables this week?"*

## Security

- **Tokens, not passwords.** The server never sees your password or a dashboard session. A token has only the scopes and apps you gave it. You can revoke it at any time in the dashboard.
- **Over HTTP, credentials come only from the request.** Each request brings its own token in the `Authorization` header. The server stores no tokens, and the token is never placed in a URL.
- **Audit log.** Every call is recorded in the account's Activity: the token, the client (e.g. Claude Code), the tool, the result and a request ID.
- **Hosted limits.** Browser origins must be allowed (`ALLOWED_ORIGINS`), requests are rate-limited per IP, and the tools that read local files or URLs are off.
- **Keys stay on the server side.** Calls to your app go through SashiDo's API with your token. The app's master key is never sent to the client or the model.

## Self-hosting

```bash
git clone https://github.com/sashido/sashido-mcp-server.git
cd sashido-mcp-server
npm ci && npm run build
npm run start:http      # HTTP on 127.0.0.1:3100
npm run start:stdio     # stdio, with SASHIDO_ACCESS_TOKEN set
```

| Variable | Default | |
|---|---|---|
| `SASHIDO_API_URL` | `https://api.sashido.io` | |
| `SASHIDO_ACCESS_TOKEN` | – | stdio only; over HTTP every request brings its own |
| `SASHIDO_READ_ONLY`, `SASHIDO_APPS`, `SASHIDO_FEATURES` | – | stdio only: narrow the connection |
| `HOST` | `127.0.0.1` | `0.0.0.0` in a container |
| `PORT` / `MCP_SERVER_PORT` | `3100` | `PORT` wins |
| `ALLOWED_ORIGINS` | – | Comma-separated browser origins; clients that aren't browsers send none |
| `TRUST_PROXY` | – | `true` behind a load balancer, so rate limits see the client's IP |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per client IP |
| `REDIS_URL`, `REDIS_PASSWORD`, `REDIS_DB` | – | SSE across several instances (Streamable HTTP needs no Redis) |
| `SESSION_TTL_SECONDS` | `3600` | SSE sessions in Redis |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

### HTTP endpoints

| Method | Path | |
|---|---|---|
| `POST` | `/mcp` | Streamable HTTP, stateless: any instance can answer |
| `GET` | `/sse`, `POST` `/sse/messages` | SSE for older clients; needs Redis with more than one instance |
| `GET` | `/health` | Status, version, SSE connections, Redis |

### In a container

Any Node.js 20+ image works: `npm ci && npm run build`, then `npm start` with `HOST=0.0.0.0` (and `TRUST_PROXY=true` behind a load balancer). Put TLS in front of it, and use `/health` for the readiness and liveness probes.

## Development

```bash
npm run dev         # stdio with reload
npm run typecheck
npm run test:run    # vitest
```

Tool calls are logged to stderr as JSON lines (tool, app, client, result, duration, request ID, a short fingerprint of the token), never with the arguments or the token itself.

## Support

- [SashiDo documentation](https://www.sashido.io/en/docs)
- [support@sashido.io](mailto:support@sashido.io)
- [GitHub issues](https://github.com/sashido/sashido-mcp-server/issues)

## License

MIT, see [LICENSE](LICENSE).
