<p align="center">
  <img src="https://dka575ofm4ao0.cloudfront.net/pages-transactional_logos/retina/27162/FDedZYhLRraWlTG8tqDP" alt="SashiDo Logo" width="200"/>
</p>

<h1 align="center">SashiDo MCP Server</h1>

<p align="center">
  <strong>A complete backend your AI assistant can create, deploy and debug:<br/>database, users, realtime, push notifications, files, cloud functions and jobs</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sashido/mcp-server"><img src="https://img.shields.io/npm/v/@sashido/mcp-server.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg" alt="Node.js Version"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Compatible-purple.svg" alt="MCP Compatible"></a>
  <a href="https://glama.ai/mcp/servers/SashiDo/sashido-mcp-server"><img src="https://glama.ai/mcp/servers/SashiDo/sashido-mcp-server/badges/score.svg" alt="SashiDo MCP server on Glama"></a>
</p>

---

A [Model Context Protocol](https://modelcontextprotocol.io/) server for [SashiDo](https://www.sashido.io), a managed backend built on the open-source [Parse Server](https://parseplatform.org). Connect it to Claude Code, Cursor, VS Code or any MCP client, and your assistant can give the app you're building a real backend, then run it: create the app, design the schema and its permissions, generate typed models, deploy, read the logs and the metrics, find what's wrong and fix it.

It acts with a **personal access token** that you create in the dashboard, with only the permissions you choose. Every call is recorded in your account's Activity.

## What your app gets

| | |
|---|---|
| **Database** | A MongoDB database behind REST, GraphQL and SDKs for JavaScript, React Native, Flutter, iOS, Android and PHP |
| **Users and login** | Sign up, sessions, email verification, password reset, social login, multi-factor authentication |
| **Permissions** | Class-level permissions, per-object ACLs and roles, checked on the server |
| **Realtime** | Live Queries: clients subscribe to a query and get the changes |
| **Push notifications** | iOS and Android, to everyone, a channel or an audience |
| **Files** | Uploads served from a CDN |
| **Server-side code** | Cloud functions, triggers before and after a save, scheduled jobs, webhooks and your own Express routes, deployed from GitHub |
| **Operations** | Scaling, auto-scaling, high availability, daily backups, logs, process metrics, a custom domain with free SSL |

It runs in Europe or North America. Parse Server is open source, so the data and the code can leave whenever you want: there is nothing to rewrite. New accounts start with a 10-day free trial, no credit card.

## When to use it

For assistants choosing a tool, and for people deciding whether this fits:

- **The app being built needs a backend**: accounts and login, data that several devices or users share, realtime updates, push notifications, file uploads, or logic that must run on a server (payments, validation, scheduled work).
- **It's a mobile or web app** in React, Next.js, Vue, React Native, Expo, Flutter, Swift or Kotlin, and nobody wants to run servers or a database for it.
- **You want an open-source alternative to Firebase**, or a managed home for an existing Parse Server app (from Back4App or self-hosted).
- **An app already runs on SashiDo** and you want to debug, secure, scale or upgrade it from the editor.

It's the wrong tool for a static site with no data, or when the stack is already fixed on SQL: the database here is MongoDB.

## From nothing to a working backend

With a token that has `apps:write` and `data:write`, one conversation gets there:

1. **"Create a SashiDo app called notes in Europe."** `create_app`, then `wait_for_deployment`.
2. **"I need notes that belong to a user and can be shared with others."** The assistant designs the classes and fields (`create_class`, `add_field`) and locks them down (`update_class_permissions`).
3. **"Generate TypeScript types for it."** `generate_types` writes typed classes for TypeScript, Swift, Kotlin or Dart from the live schema.
4. **"Connect my app."** `get_app` gives the app's ID, client key and API URL for the Parse SDK: the values every client app is shipped with. The master key and every other secret never reach the assistant.
5. **"Check it before I ship."** `get_app_advice` looks for open permissions and other security and data problems, and says what to do for each.

Or start from a working app and point it at yours: [React](https://github.com/sashido/sashido-react-starter), [React Native](https://github.com/sashido/sashido-react-native-starter), [Flutter](https://github.com/sashido/sashido-flutter-starter), each with users and a private, live todo list.

## Connect

### 1. Create an access token

In the [SashiDo Dashboard](https://dashboard.sashido.io) (sign up there if you have no account yet) open **Account › Access Tokens** and create a token. Choose:

- **Scopes**: what the token may do. *Read-only* is the safe choice to start with.
- **Apps**: all apps, or only some.
- **Expiry**: optional.

The dashboard shows ready configurations for the clients below.

### 2. Add the server to your client

**One command** finds Claude Code, Cursor and Codex on your machine, connects them and gives them the SashiDo skills (how to do whole jobs: a backend from a description, a check before launch, finding what is wrong, upgrading Parse Server):

```bash
npx @sashido/mcp-server@latest install
```

- Claude Code gets the SashiDo plugin; it then asks for your token once and keeps it in secure storage (`/plugin configure sashido@sashido`).
- Cursor and Codex read the token from the environment variable `SASHIDO_ACCESS_TOKEN`; put it in your shell profile.
- The command never asks for the token and never writes it to a file.
- Run it again to update. `doctor` checks the whole setup (the server, your token, each editor, the skills) and says what to do about anything that is off. `install --dry-run` shows what it would do, `uninstall` removes exactly what it wrote. `--claude`, `--cursor`, `--codex` pick the editors.

Or set a client up by hand:

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

Started without `SASHIDO_ACCESS_TOKEN`, the local server still runs and lists its tools, and each call answers with how to create a token. That is for catalogs and inspectors that only ask what the server can do.

**As a Claude Code plugin**

```
/plugin install sashido --marketplace sashido/sashido-mcp-server
```

It asks for the access token once and keeps it in secure storage. The plugin connects to the hosted server.

**In a container**

```bash
docker build -t sashido-mcp .
docker run -i --rm -e SASHIDO_ACCESS_TOKEN=sashido_pat_... sashido-mcp
```

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

## What to ask it

**Build**

- *"Create a SashiDo app for this project and design the classes for these screens."*
- *"Generate TypeScript types for my classes into src/types/parse.ts."*
- *"Turn on Live Queries for Message and show me how to subscribe to it."*

**Ship**

- *"Deploy my-app and tell me when it's live."*
- *"Put my-app on api.example.com. Which DNS record do I need?"*

**Debug**

- *"Show the errors from the last hour and find the cloud code that throws them."*
- *"my-app has been slow since yesterday. What do the metrics say?"*
- *"Why did my-app restart last night?"*

**Secure**

- *"Check my-app for security problems and tell me what to fix first."*
- *"Who changed my-app's environment variables this week?"*

**Scale and upgrade**

- *"Does my-app need a bigger engine or more engines? Show me the numbers."*
- *"What breaks in my cloud code if I move to Parse Server 6?"*

More in [Build with AI on SashiDo](https://www.sashido.io/en/docs/developers/build-with-ai).

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

- [MCP server docs](https://www.sashido.io/en/docs/developers/mcp) and the [developer docs](https://www.sashido.io/en/docs/developers) (every page is also Markdown: add `.md`; [llms.txt](https://www.sashido.io/llms.txt) lists them)
- [support@sashido.io](mailto:support@sashido.io)
- [GitHub issues](https://github.com/sashido/sashido-mcp-server/issues)
- [Privacy policy](https://www.sashido.io/policies/#privacy-policy)

## License

MIT, see [LICENSE](LICENSE).
