#!/usr/bin/env node

import { startStdioServer } from '../transports/stdio.js';

const args = process.argv.slice(2);
const transportArg = args.find((arg) => arg.startsWith('--transport='));
const transport = transportArg?.split('=')[1] ?? 'stdio';

async function main(): Promise<void> {
  try {
    if (transport === 'stdio') {
      await startStdioServer();
    } else if (transport === 'http') {
      const { startHttpServer } = await import('../transports/http.js');
      await startHttpServer();
    } else {
      console.error(`Unknown transport: ${transport}`);
      console.error('Available transports: stdio, http');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
