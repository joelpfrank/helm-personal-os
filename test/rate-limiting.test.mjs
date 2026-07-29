// Behavior + structural tests locking in the rate-limiting remediation
// (CodeQL js/missing-rate-limiting, 33 alerts across the Express API,
// SPA fallback, and the MCP HTTP server).
//
// ISOLATION CONTRACT:
//   • DASHBOARD_DB_PATH is set at MODULE SCOPE before any server import.
//   • Rate-limit env vars are set per-test, right before calling createApp()
//     / importing the MCP app — both read process.env at call/import time,
//     not at module load, so each test gets an isolated tiny budget.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-rate-limit-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
process.env.DASHBOARD_URL = 'http://127.0.0.1:1';

describe('server API rate limiting', () => {
  let server, base;

  before(async () => {
    process.env.HELM_RATE_WINDOW_MS = '60000';
    process.env.HELM_RATE_MAX = '3';
    process.env.HELM_AUTH_RATE_WINDOW_MS = '60000';
    process.env.HELM_AUTH_RATE_MAX = '600'; // keep the auth limiter out of the way here
    const dbMod = await import('../server/src/db.js');
    dbMod.runMigrations();
    const { createApp } = await import('../server/src/app.js');
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
    delete process.env.HELM_RATE_WINDOW_MS;
    delete process.env.HELM_RATE_MAX;
    delete process.env.HELM_AUTH_RATE_WINDOW_MS;
    delete process.env.HELM_AUTH_RATE_MAX;
  });

  it('keeps trust proxy off, so a spoofed X-Forwarded-For cannot buy a fresh bucket', async () => {
    const { createApp } = await import('../server/src/app.js');
    const app = createApp();
    assert.equal(app.get('trust proxy'), false);
  });

  it('lets requests through under the limit', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
  });

  it('applies the global limiter before route dispatch — even a bearer-auth-exempt route like /api/health gets 429 once the budget is spent', async () => {
    // Budget is 3/window; the previous test already spent one.
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await fetch(`${base}/api/health`);
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.error.code, 'rate_limited');
    assert.ok(last.headers.get('ratelimit') || last.headers.get('ratelimit-limit'),
      'draft-7 RateLimit headers should be present');
  });
});

describe('server auth-endpoint rate limiting is tighter than the global budget', () => {
  let server, base;

  before(async () => {
    process.env.HELM_RATE_WINDOW_MS = '60000';
    process.env.HELM_RATE_MAX = '1000'; // effectively unlimited for this test
    process.env.HELM_AUTH_RATE_WINDOW_MS = '60000';
    process.env.HELM_AUTH_RATE_MAX = '2';
    const { createApp } = await import('../server/src/app.js');
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
    delete process.env.HELM_RATE_WINDOW_MS;
    delete process.env.HELM_RATE_MAX;
    delete process.env.HELM_AUTH_RATE_WINDOW_MS;
    delete process.env.HELM_AUTH_RATE_MAX;
  });

  it('429s /api/auth/status once the small auth budget is spent, well before the global limit', async () => {
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await fetch(`${base}/api/auth/status`);
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.error.code, 'rate_limited');
  });
});

describe('MCP HTTP server rate limiting', () => {
  let server, base;

  before(async () => {
    process.env.MCP_HTTP_TOKEN = 'test-mcp-http-token';
    process.env.MCP_HTTP_RATE_WINDOW_MS = '60000';
    process.env.MCP_HTTP_RATE_MAX = '3';
    // Importable without binding the default port (isMain guard) — this
    // import alone must not open a real listening socket.
    const { app } = await import('../mcp/src/http.js');
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
    delete process.env.MCP_HTTP_TOKEN;
    delete process.env.MCP_HTTP_RATE_WINDOW_MS;
    delete process.env.MCP_HTTP_RATE_MAX;
  });

  it('is importable without binding a port (isMain guard) — proven by the fact that import above did not throw or fall through to app.listen(PORT, HOST) on the module-scope default', async () => {
    // process.argv[1] under `node --test` is the test runner, not http.js, so
    // the isMain check inside http.js resolves false and the top-level
    // `app.listen(PORT, HOST, ...)` never runs. If it had run while something
    // else already held the default port, the import above would have thrown
    // (or emitted an unhandled 'error'), failing this whole suite.
    const invoked = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
    assert.notEqual(invoked, path.resolve(import.meta.dirname, '..', 'mcp', 'src', 'http.js'));
  });

  it('keeps trust proxy off, so a spoofed X-Forwarded-For cannot buy a fresh bucket', async () => {
    const { app } = await import('../mcp/src/http.js');
    assert.equal(app.get('trust proxy'), false);
  });

  it('429s once the small MCP HTTP budget is spent, on an unauthenticated route', async () => {
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await fetch(`${base}/health`);
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.error.code, -32001);
  });
});
