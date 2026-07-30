// Thin Google Calendar API client. Reads OAuth client creds from
// .google-credentials.json (state-dir contract: $HELM_STATE_DIR or the
// project root) and pulls the refresh token + current access token from
// the calendar_settings table.

import fs from 'node:fs';
import { db } from '../db.js';
import { googleCredentialsPath } from './state-paths.js';

let cachedCreds = null;
export function getCreds() {
  if (cachedCreds) return cachedCreds;
  const CREDS_PATH = googleCredentialsPath();
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(
      `.google-credentials.json not found at ${CREDS_PATH}. Add { client_id, client_secret, redirect_uri } to enable calendar.`,
    );
  }
  cachedCreds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  if (!cachedCreds.client_id || !cachedCreds.client_secret) {
    throw new Error('.google-credentials.json missing client_id / client_secret');
  }
  if (!cachedCreds.redirect_uri) {
    cachedCreds.redirect_uri = 'http://localhost:8787/api/calendar/auth/callback';
  }
  return cachedCreds;
}

const settingsStmts = {
  read: db.prepare('SELECT * FROM calendar_settings WHERE id = 1'),
  insertOrUpdate: db.prepare(`
    INSERT INTO calendar_settings (
      id, calendar_id, email, refresh_token, access_token, access_expires_at,
      sync_token, last_sync_at, last_sync_error, authorized_at, sync_from, sync_to
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      calendar_id       = COALESCE(excluded.calendar_id,       calendar_settings.calendar_id),
      email             = COALESCE(excluded.email,             calendar_settings.email),
      refresh_token     = COALESCE(excluded.refresh_token,     calendar_settings.refresh_token),
      access_token      = COALESCE(excluded.access_token,      calendar_settings.access_token),
      access_expires_at = COALESCE(excluded.access_expires_at, calendar_settings.access_expires_at),
      sync_token        = COALESCE(excluded.sync_token,        calendar_settings.sync_token),
      last_sync_at      = COALESCE(excluded.last_sync_at,      calendar_settings.last_sync_at),
      last_sync_error   = excluded.last_sync_error,
      authorized_at     = COALESCE(excluded.authorized_at,     calendar_settings.authorized_at),
      sync_from         = COALESCE(excluded.sync_from,         calendar_settings.sync_from),
      sync_to           = COALESCE(excluded.sync_to,           calendar_settings.sync_to)
  `),
  setSyncToken: db.prepare(`
    UPDATE calendar_settings SET sync_token = ?, last_sync_at = ?, last_sync_error = NULL WHERE id = 1
  `),
  setSyncError: db.prepare(`
    UPDATE calendar_settings SET last_sync_error = ?, last_sync_at = ? WHERE id = 1
  `),
  setAccess: db.prepare(`
    UPDATE calendar_settings SET access_token = ?, access_expires_at = ? WHERE id = 1
  `),
  clearSyncToken: db.prepare('UPDATE calendar_settings SET sync_token = NULL WHERE id = 1'),
  clear: db.prepare('DELETE FROM calendar_settings WHERE id = 1'),
};

export function getSettings() {
  return settingsStmts.read.get() || null;
}

export function saveSettings(patch) {
  const cur = settingsStmts.read.get() || {};
  settingsStmts.insertOrUpdate.run(
    patch.calendar_id ?? null,
    patch.email ?? null,
    patch.refresh_token ?? null,
    patch.access_token ?? null,
    patch.access_expires_at ?? null,
    patch.sync_token ?? null,
    patch.last_sync_at ?? null,
    patch.last_sync_error ?? null,
    patch.authorized_at ?? null,
    patch.sync_from ?? null,
    patch.sync_to ?? null,
  );
  return settingsStmts.read.get();
}

export function setSyncToken(token) {
  settingsStmts.setSyncToken.run(token, new Date().toISOString());
}
export function setSyncError(msg) {
  settingsStmts.setSyncError.run(String(msg), new Date().toISOString());
}
export function clearSyncToken() {
  settingsStmts.clearSyncToken.run();
}
export function clearSettings() {
  settingsStmts.clear.run();
}

// ---------- OAuth ----------

export function buildAuthUrl(state) {
  const { client_id, redirect_uri } = getCreds();
  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: state || 'dashboard',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  const { client_id, client_secret, redirect_uri } = getCreds();
  const body = new URLSearchParams({
    code, client_id, client_secret, redirect_uri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, scope, token_type, id_token? }
}

async function refreshAccessToken(refreshToken) {
  const { client_id, client_secret } = getCreds();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id, client_secret,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, expires_in, scope, token_type, id_token? }
}

// Returns a valid access token, refreshing if within 60s of expiry.
export async function getAccessToken() {
  const s = getSettings();
  if (!s || !s.refresh_token) throw new Error('not authorized — visit /api/calendar/auth/start');
  const now = Date.now();
  const exp = s.access_expires_at ? new Date(s.access_expires_at).getTime() : 0;
  if (s.access_token && exp > now + 60_000) return s.access_token;
  const refreshed = await refreshAccessToken(s.refresh_token);
  const newExpiresAt = new Date(now + (refreshed.expires_in || 3600) * 1000).toISOString();
  settingsStmts.setAccess.run(refreshed.access_token, newExpiresAt);
  return refreshed.access_token;
}

// ---------- Google Calendar API ----------

const BASE = 'https://www.googleapis.com/calendar/v3';

export async function gcalFetch(path, opts = {}) {
  const access = await getAccessToken();
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${access}` };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    const err = new Error(`gcal ${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchUserInfo() {
  const access = await getAccessToken();
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json();
}

export async function listCalendarList() {
  const r = await gcalFetch('/users/me/calendarList');
  return r.items || [];
}

export async function getCalendar(calendarId) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}`);
}

export async function listEvents(calendarId, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`);
}

export async function insertEvent(calendarId, body) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function patchEvent(calendarId, eventId, body) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteEvent(calendarId, eventId) {
  return gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}
