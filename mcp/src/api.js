import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveToken() {
  if (process.env.DASHBOARD_TOKEN) return process.env.DASHBOARD_TOKEN.trim();
  // Fall back to the project root's .dashboard-token (two levels up from mcp/src).
  const tokenPath = path.resolve(__dirname, '..', '..', '.dashboard-token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  throw new Error('DASHBOARD_TOKEN not set and .dashboard-token not found at ' + tokenPath);
}

const URL_BASE = (process.env.DASHBOARD_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
let TOKEN = null;

export async function api(method, path, body) {
  if (!TOKEN) TOKEN = resolveToken();
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const url = `${URL_BASE}/api${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) {
    let info = null;
    try { info = await res.json(); } catch {}
    const err = new Error(info?.error?.message || `${res.status} ${res.statusText} on ${method} ${path}`);
    err.status = res.status;
    err.code = info?.error?.code;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const apiGet    = (p) => api('GET', p);
export const apiPost   = (p, body) => api('POST', p, body);
export const apiPut    = (p, body) => api('PUT', p, body);
export const apiPatch  = (p, body) => api('PATCH', p, body);
export const apiDelete = (p) => api('DELETE', p);
