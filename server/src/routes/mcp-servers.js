import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { intParam, requireString, optionalString, rejectUnknownKeys } from '../lib/validate.js';
import { BACKEND } from '../lib/llm.js';
import { maskSecretObject, mergeSecrets, parseJSON } from '../lib/external-mcp.js';

const router = Router();

// Helm-as-MCP-server (OUT): the standalone MCP HTTP server (mcp/src/http.js)
// exposes every dashboard tool at /mcp, bearer-gated by .mcp-http-token.
// This surfaces the connection details to the authenticated owner.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_TOKEN_PATH = path.resolve(__dirname, '..', '..', '..', '.mcp-http-token');
function readMcpToken() {
  try {
    if (process.env.MCP_HTTP_TOKEN) return process.env.MCP_HTTP_TOKEN.trim();
    return fs.readFileSync(MCP_TOKEN_PATH, 'utf8').trim();
  } catch { return null; }
}

const TRANSPORTS = new Set(['http', 'sse', 'stdio']);

const sql = {
  list: db.prepare('SELECT * FROM external_mcp_servers ORDER BY id'),
  get: db.prepare('SELECT * FROM external_mcp_servers WHERE id = ?'),
  byName: db.prepare('SELECT id FROM external_mcp_servers WHERE LOWER(name) = LOWER(?)'),
  insert: db.prepare(`
    INSERT INTO external_mcp_servers (name, label, transport, url, command, args, headers, env, always_load, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM external_mcp_servers WHERE id = ?'),
};

function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

// Never return raw secrets — mask header/env values, keep their keys visible.
function shape(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, label: row.label, transport: row.transport,
    url: row.url, command: row.command,
    args: parseJSON(row.args, []),
    headers: maskSecretObject(row.headers),
    env: maskSecretObject(row.env),
    always_load: !!row.always_load,
    enabled: !!row.enabled,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function objOrEmpty(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

// Lets the UI warn that external tools only run on the SDK (subscription) backend.
router.get('/status', (_req, res) => {
  res.json({ backend: BACKEND, sdk: BACKEND === 'sdk' });
});

// Connection details for driving Helm from an external MCP client (Claude
// Desktop, Cursor…). Returns the token to the authenticated owner only.
// public_url is per-instance via MCP_PUBLIC_URL env — localhost-only until set.
router.get('/self', (_req, res) => {
  const token = readMcpToken();
  const port = Number(process.env.MCP_HTTP_PORT || 8788);
  const local = `http://127.0.0.1:${port}`;
  const publicUrl = (process.env.MCP_PUBLIC_URL || '').replace(/\/+$/, '') || null;
  const base = publicUrl || local;
  res.json({
    available: !!token,
    public: !!publicUrl,
    base,
    local_endpoint: `${local}/mcp`,
    token,
    bearer_endpoint: `${base}/mcp`,
    url_token_endpoint: token ? `${base}/mcp/${token}` : null,
  });
});

router.get('/', (_req, res) => {
  res.json(sql.list.all().map(shape));
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'label', 'transport', 'url', 'command', 'args', 'headers', 'env', 'always_load', 'enabled']);
    const label = requireString(req.body, 'label');
    const transport = optionalString(req.body, 'transport') || 'http';
    if (!TRANSPORTS.has(transport)) throw errors.validation('transport must be http, sse, or stdio');
    const nameRaw = optionalString(req.body, 'name');
    const name = (nameRaw && nameRaw.trim()) ? slugify(nameRaw) : slugify(label);
    if (!name) throw errors.validation('could not derive a name; provide one');
    if (sql.byName.get(name)) throw errors.conflict(`server "${name}" already exists`);
    const url = optionalString(req.body, 'url') ?? null;
    const command = optionalString(req.body, 'command') ?? null;
    if ((transport === 'http' || transport === 'sse') && !url) throw errors.validation(`${transport} transport needs a url`);
    if (transport === 'stdio' && !command) throw errors.validation('stdio transport needs a command');
    const args = Array.isArray(req.body.args) ? req.body.args.map(String) : [];
    const headers = objOrEmpty(req.body.headers);
    const env = objOrEmpty(req.body.env);
    const alwaysLoad = req.body.always_load === false ? 0 : 1; // default on so tools are present
    const enabled = req.body.enabled === false ? 0 : 1;
    const info = sql.insert.run(name, label, transport, url, command, JSON.stringify(args), JSON.stringify(headers), JSON.stringify(env), alwaysLoad, enabled);
    res.status(201).json(shape(sql.get.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.get.get(id);
    if (!row) throw errors.notFound('server not found');
    rejectUnknownKeys(req.body, ['label', 'transport', 'url', 'command', 'args', 'headers', 'env', 'always_load', 'enabled']);
    const updates = [];
    const vals = [];
    const set = (col, v) => { updates.push(`${col} = ?`); vals.push(v); };
    const label = optionalString(req.body, 'label');
    if (label !== undefined) { if (!label.trim()) throw errors.validation('label must be non-empty'); set('label', label.trim()); }
    const transport = optionalString(req.body, 'transport');
    if (transport !== undefined) { if (!TRANSPORTS.has(transport)) throw errors.validation('transport must be http, sse, or stdio'); set('transport', transport); }
    if ('url' in (req.body || {})) set('url', optionalString(req.body, 'url') ?? null);
    if ('command' in (req.body || {})) set('command', optionalString(req.body, 'command') ?? null);
    if ('args' in (req.body || {})) set('args', JSON.stringify(Array.isArray(req.body.args) ? req.body.args.map(String) : []));
    if ('headers' in (req.body || {})) set('headers', JSON.stringify(mergeSecrets(row.headers, objOrEmpty(req.body.headers))));
    if ('env' in (req.body || {})) set('env', JSON.stringify(mergeSecrets(row.env, objOrEmpty(req.body.env))));
    if ('always_load' in (req.body || {})) set('always_load', req.body.always_load ? 1 : 0);
    if ('enabled' in (req.body || {})) set('enabled', req.body.enabled ? 1 : 0);
    if (updates.length) { vals.push(id); db.prepare(`UPDATE external_mcp_servers SET ${updates.join(', ')} WHERE id = ?`).run(...vals); }
    res.json(shape(sql.get.get(id)));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('server not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
