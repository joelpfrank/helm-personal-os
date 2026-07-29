#!/usr/bin/env node
// HTTP MCP entry point. Speaks the Streamable HTTP transport at /mcp so
// Anthropic's servers (calling on behalf of claude.ai web, iOS, iPadOS,
// or Claude Desktop) can use the Helm tools.
//
// Bearer-token auth on /mcp; the token lives in `.mcp-http-token` at the
// project root (generated on first start). Keep this separate from
// Helm's own `.dashboard-token` so a leak here doesn't widen blast.
//
// Listens on 127.0.0.1:8788 by default. Operators who deliberately expose
// it through a secure reverse proxy remain responsible for access controls.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerTools } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.MCP_HTTP_PORT || 8788);
const HOST = process.env.MCP_HTTP_HOST || '127.0.0.1';
const TOKEN_PATH = path.resolve(__dirname, '..', '..', '.mcp-http-token');

function resolveToken() {
  if (process.env.MCP_HTTP_TOKEN) return process.env.MCP_HTTP_TOKEN.trim();
  if (fs.existsSync(TOKEN_PATH)) {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_PATH, generated + '\n', { mode: 0o600 });
  try { fs.chmodSync(TOKEN_PATH, 0o600); } catch {}
  console.error('[helm-personal-os-mcp-http] generated new token at', TOKEN_PATH);
  console.error('[helm-personal-os-mcp-http] paste this into Claude → Settings → Connectors:');
  console.error('[helm-personal-os-mcp-http]', generated);
  return generated;
}

const TOKEN = resolveToken();
const TOKEN_BUF = Buffer.from(TOKEN, 'utf8');

function constantTimeEq(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorizedByHeader(req) {
  const header = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  return constantTimeEq(Buffer.from(m[1].trim(), 'utf8'), TOKEN_BUF);
}

function authorizedByPathToken(token) {
  if (typeof token !== 'string' || !token) return false;
  return constantTimeEq(Buffer.from(token, 'utf8'), TOKEN_BUF);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// CORS — Anthropic's servers call us server-to-server, but in case a
// browser client (claude.ai web?) ever does a preflight, accept it.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health (no auth) — useful for local or reverse-proxy monitoring.
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'helm-personal-os-mcp-http', version: '0.1.0' });
});

// Two authentication modes:
//   1. /mcp  + Authorization: Bearer <token>   — for MCP clients that
//      support header auth (e.g. stdio-style clients, custom scripts).
//   2. /mcp/<token>                            — for clients whose UI
//      only takes a URL (e.g. Anthropic's "Add custom connector" modal,
//      which has no bearer-token field). The token IS the URL.
// Both validate against the same .mcp-http-token via constant-time compare.

app.use('/mcp/:token', (req, res, next) => {
  if (!authorizedByPathToken(req.params.token)) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'unauthorized' },
    });
  }
  next();
});

app.use('/mcp', (req, res, next) => {
  // Skip the header gate if this is the path-token variant (it'll have
  // been handled above already and won't reach here with a sub-path).
  if (req.path !== '/' && req.path !== '') return next();
  if (!authorizedByHeader(req)) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'unauthorized' },
    });
  }
  next();
});

async function handleMcp(req, res) {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: 1 transport per request
    });
    const server = new McpServer({ name: 'helm-personal-os-mcp', version: '0.1.0' });
    registerTools(server);

    res.on('close', () => {
      transport.close?.().catch?.(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[helm-personal-os-mcp-http] error handling request:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'internal' },
      });
    }
  }
}

app.post('/mcp', handleMcp);
app.get('/mcp', handleMcp);
app.delete('/mcp', handleMcp);
app.post('/mcp/:token', handleMcp);
app.get('/mcp/:token', handleMcp);
app.delete('/mcp/:token', handleMcp);

const server = app.listen(PORT, HOST, () => {
  console.error(`[helm-personal-os-mcp-http] listening on http://${HOST}:${PORT}/mcp`);
});

function shutdown(signal) {
  console.error(`[helm-personal-os-mcp-http] received ${signal}, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
