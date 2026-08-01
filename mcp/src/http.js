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
import { pathToFileURL } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerTools } from './tools.js';
// Shared state-dir contract: mcp/ and server/ are siblings both in the repo
// and in an installed prefix, so this relative import holds in both layouts.
import { mcpHttpTokenPath, ensureStateDir } from '../../server/src/lib/state-paths.js';

const PORT = Number(process.env.MCP_HTTP_PORT || 8788);
const HOST = process.env.MCP_HTTP_HOST || '127.0.0.1';
const TOKEN_PATH = mcpHttpTokenPath();

function resolveToken() {
  if (process.env.MCP_HTTP_TOKEN) return process.env.MCP_HTTP_TOKEN.trim();
  if (fs.existsSync(TOKEN_PATH)) {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  ensureStateDir();
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

// Parse "Bearer <token>" without a backtracking regex. The old
// `/^Bearer\s+(.+)$/i` was polynomial (`\s+` and `.+` both match spaces),
// so a header of many spaces could stall the event loop
// (CodeQL js/polynomial-redos). This is linear.
function parseBearerToken(header) {
  const s = typeof header === 'string' ? header : '';
  if (s.slice(0, 6).toLowerCase() !== 'bearer') return null;
  const rest = s.slice(6);
  if (rest === '' || rest[0].trim() !== '') return null;
  const token = rest.trim();
  return token || null;
}

function authorizedByHeader(req) {
  const token = parseBearerToken(req.get('authorization'));
  if (!token) return false;
  return constantTimeEq(Buffer.from(token, 'utf8'), TOKEN_BUF);
}

function authorizedByPathToken(token) {
  if (typeof token !== 'string' || !token) return false;
  return constantTimeEq(Buffer.from(token, 'utf8'), TOKEN_BUF);
}

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const app = express();
app.disable('x-powered-by');
// Never trust forwarded IP headers: this binds to loopback by default and any
// reverse proxy is the operator's responsibility. Keeping trust-proxy off means
// req.ip is the real socket peer, so rate-limit buckets can't be forged with a
// spoofed X-Forwarded-For.
app.set('trust proxy', false);
app.use(express.json({ limit: '4mb' }));

// Blunt runaway clients before any request reaches the (expensive) MCP
// transport. Local/self-hosted defaults are generous; override via env.
app.use(rateLimit({
  windowMs: positiveInt(process.env.MCP_HTTP_RATE_WINDOW_MS, 60 * 1000),
  limit: positiveInt(process.env.MCP_HTTP_RATE_MAX, 600),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { jsonrpc: '2.0', error: { code: -32001, message: 'rate limited' } },
}));

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
  res.json({ ok: true, service: 'helm-personal-os-mcp-http', version: '0.0.0' });
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
    const server = new McpServer({ name: 'helm-personal-os-mcp', version: '0.0.0' });
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

// Exported so tests can mount the app on an ephemeral port without binding the
// default 8788 or resolving the real on-disk token.
export { app };

// Only bind a port when run as the entrypoint (`helm-personal-os-mcp-http`),
// not when imported by a test. realpath handles npm's bin symlink.
const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const isMain = invokedPath && pathToFileURL(invokedPath).href === import.meta.url;

if (isMain) {
  const server = app.listen(PORT, HOST, () => {
    console.error(`[helm-personal-os-mcp-http] listening on http://${HOST}:${PORT}/mcp`);
  });

  const shutdown = (signal) => {
    console.error(`[helm-personal-os-mcp-http] received ${signal}, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
