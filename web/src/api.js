import { useLangStore } from './lib/i18n.js';

const TOKEN_KEY = 'dashboard_token';

(function captureTokenFromQuery() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const t = params.get('token');
  if (!t) return;
  localStorage.setItem(TOKEN_KEY, t);
  // Strip the token from the URL only when in a regular browser tab.
  // In a PWA / standalone install, the launch URL is what the OS
  // re-opens every time, so the ?token=... has to stay there — the
  // PWA has its own isolated localStorage that the browser's tab
  // localStorage cannot seed.
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;
  params.delete('token');
  const search = params.toString();
  const url = window.location.pathname + (search ? '?' + search : '') + window.location.hash;
  window.history.replaceState(null, '', url);
})();

const PROD = !import.meta.env.DEV;

function token() {
  if (!PROD) return null; // dev: vite proxy injects it
  return localStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const t = token();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (opts.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    // A 401 in production means our stored token is stale/invalid. Drop it
    // and reload so the password gate takes over.
    if (res.status === 401 && PROD) {
      localStorage.removeItem(TOKEN_KEY);
      if (typeof window !== 'undefined') window.location.reload();
    }
    const msg = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, body?.error?.code);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const apiGet = (path) => api(path);
export const apiPost = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const apiPut = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const apiPatch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDelete = (path) => api(path, { method: 'DELETE' });

export function hasToken() {
  return PROD ? Boolean(token()) : true;
}

export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Auth helpers. These do NOT carry a bearer token — they're how the browser
// obtains one. The server exposes /api/auth/* without auth.
export async function getAuthStatus() {
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new ApiError('cannot reach server', res.status);
  return res.json(); // { hasPassword: boolean }
}

async function authPost(path, password) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, body?.error?.code);
  }
  if (body?.token) setToken(body.token);
  return body;
}

export const login = (password) => authPost('/auth/login', password);
export const setupPassword = (password) => authPost('/auth/setup', password);

// Upload a recorded audio blob; the server transcribes it with whisper.cpp
// and returns the text. Sent as a raw binary body, not JSON.
export async function transcribeAudio(blob) {
  const headers = {};
  const t = token();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  if (blob && blob.type) headers['Content-Type'] = blob.type;
  let lang = 'en';
  try { lang = useLangStore.getState().lang; } catch { /* ignore */ }
  const res = await fetch('/api/chat/transcribe?lang=' + lang, { method: 'POST', headers, body: blob });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    throw new ApiError(body?.error?.message || `${res.status} ${res.statusText}`, res.status, body?.error?.code);
  }
  const data = await res.json();
  return (data && data.text) || '';
}
