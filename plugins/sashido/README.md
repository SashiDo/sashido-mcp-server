# SashiDo plugin for Claude

Connects Claude to [SashiDo](https://www.sashido.io), a managed backend built on the open-source Parse Server: a MongoDB database, users and login, permissions, realtime, push notifications, files, cloud functions and scheduled jobs.

With it Claude can create an app, design the classes and their permissions, generate typed models for your client, deploy and wait until it is live, read the logs and the process metrics, find why something fails or is slow, and check the app for security problems before it ships.

## Setup

1. In the [SashiDo Dashboard](https://dashboard.sashido.io) open **Account › Access Tokens** and create a token. Choose what it may do and which apps it reaches. Read-only is the safe start.
2. Install the plugin. It asks for the token once and keeps it in secure storage.

   In Claude Code:

   ```
   /plugin install sashido --marketplace sashido/sashido-mcp-server
   ```

The plugin connects to the hosted SashiDo MCP server at `https://mcp.sashido.io/mcp`. Nothing is installed on your machine and no secret is stored in a file.

## Skills

The plugin also teaches Claude how to do whole jobs with those tools. You don't call them; Claude picks one from what you ask.

| Skill | When |
|---|---|
| `new-backend` | Your app needs a backend: accounts, stored data, sharing. From a plain description to a running, locked-down backend connected to your project, with typed models |
| `ready-to-ship` | Before launch or a deploy: what must be fixed first, what should be, what is fine |
| `diagnose` | Something is slow, failing or restarting: the cause, from metrics, errors, deployments and the code that really runs |
| `upgrade-parse-server` | A newer Parse Server version: code first, then the version, with a way back |

They explain things by what they mean for your app, show the plan before changing anything, and end with what is true now.

## What to ask

- "Create a SashiDo app for this project and design the classes for these screens."
- "Show the errors from the last hour and find the cloud code that throws them."
- "my-app has been slow since yesterday. What do the metrics say?"
- "Check my-app for security problems and tell me what to fix first."

## Safety

Every tool is marked as read, write or destructive. Changes that are hard to undo show what will happen first. Every call is recorded in your account's Activity with the token, the client and the tool. Changing an engine, scaling or high availability affects your bill.

## Links

- [MCP server docs](https://www.sashido.io/en/docs/developers/mcp)
- [Source](https://github.com/sashido/sashido-mcp-server), MIT
- [Privacy policy](https://www.sashido.io/policies/#privacy-policy)
- [support@sashido.io](mailto:support@sashido.io)
