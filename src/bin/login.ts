#!/usr/bin/env node

// The MCP server no longer logs in with a password or uses session tokens:
// it takes a personal access token with only the permissions you choose.

console.log(`
SashiDo MCP Server uses personal access tokens.

1. Open the SashiDo Dashboard: Account > Access Tokens.
2. Create a token (Read-only is the safe choice for AI assistants).
3. Set it for the server, e.g.:

   SASHIDO_ACCESS_TOKEN=sashido_pat_... npx @sashido/mcp-server

The dashboard shows ready configurations for Claude, Cursor, VS Code and more.
`);
