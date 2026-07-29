#!/usr/bin/env node
// Stdio MCP entry point. Spawned by Claude Desktop / Claude Code as a
// child process. Talks JSON-RPC over stdin/stdout. For the optional HTTP
// entry (used by remote MCP clients), see ./http.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerTools } from './tools.js';

const server = new McpServer({ name: 'helm-personal-os-mcp', version: '0.1.0' });
registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[helm-personal-os-mcp] connected');
}

main().catch((err) => {
  console.error('[helm-personal-os-mcp] fatal:', err);
  process.exit(1);
});
