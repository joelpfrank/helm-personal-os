// TDD tests: first-run/auth safety on the default 'sdk' backend, driven
// through the real Express app. RED first — the /api/chat/status contract
// and the unconfigured-send guard must FAIL before chat.js is wired to the
// capability layer.
//
// ISOLATION CONTRACT (same as coach-briefing-tasks.test.mjs):
//   • DASHBOARD_DB_PATH is set at MODULE SCOPE before any server import.
//   • The Claude CLI is NEVER really spawned: HELM_CLAUDE_BIN points at
//     throwaway fixture scripts, switched per test. No Anthropic credential
//     exists in the environment and no network/paid call can occur.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-auth-sdk-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
process.env.DASHBOARD_URL = 'http://127.0.0.1:1';
process.env.HELM_AUTH_STATUS_TTL_MS = '0'; // fresh probe per request in tests
delete process.env.LLM_BACKEND;            // default backend: sdk
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

// CLI fixtures — each impersonates one `claude auth status` outcome.
function fixture(name, script) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}
const CLI = {
  missing: path.join(TMP, 'no-such-claude'),
  ok: fixture('claude-ok', `echo '{"loggedIn":true,"authMethod":"claude.ai"}'`),
  envSafe: fixture('claude-env-safe', [
    'if [ -n "$ANTHROPIC_API_KEY$ANTHROPIC_AUTH_TOKEN" ]; then',
    '  echo "credential environment leaked" >&2; exit 1',
    'fi',
    `echo '{"loggedIn":true,"authMethod":"claude.ai"}'`,
  ].join('\n')),
  unauthenticated: fixture('claude-unauth', `echo '{"loggedIn":false}' ; exit 1`),
  expired: fixture('claude-expired', 'echo "Token expired. Please run /login" >&2; exit 1'),
  garbage: fixture('claude-garbage', 'echo "flurble"'),
};

let server, base, headers;

before(async () => {
  const dbMod = await import('../server/src/db.js');
  assert.equal(path.dirname(dbMod.db.name), TMP,
    `refusing to run: db.js opened ${dbMod.db.name}, not the isolated test DB`);
  dbMod.runMigrations();
  const { getToken } = await import('../server/src/auth.js');
  const { createApp } = await import('../server/src/app.js');
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
});

after(() => { server?.close(); });

async function status() {
  const res = await fetch(`${base}/chat/status`, { headers });
  assert.equal(res.status, 200);
  return res.json();
}

describe('state 1 — no Claude Code auth and no API key', () => {
  it('reports unconfigured with a distinct reason and actionable setup', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.missing;
    const s = await status();
    assert.equal(s.backend, 'sdk');
    assert.equal(s.configured, false);
    assert.equal(s.state, 'unconfigured');
    assert.equal(s.reason, 'cli_missing');
    assert.match(s.summary, /\S/);
    assert.match(s.setup, /install|\/login|ANTHROPIC_API_KEY/i);
  });

  it('keeps core non-AI routes fully usable', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.missing;
    const boards = await fetch(`${base}/boards`, { headers });
    assert.equal(boards.status, 200);
    const created = await fetch(`${base}/boards`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'First-run board' }),
    });
    assert.equal(created.status, 201);
    const briefing = await fetch(`${base}/coach/briefing`, { headers });
    assert.equal(briefing.status, 200);
    assert.ok('cadence_pending' in await briefing.json());
    const habits = await fetch(`${base}/habits`, { headers });
    assert.equal(habits.status, 200);
    const convs = await fetch(`${base}/chat/conversations`, { headers });
    assert.equal(convs.status, 200, 'chat CRUD (non-AI) stays available');
  });

  it('rejects a coach message with a safe, actionable JSON error — not a crash, not an SDK spawn', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.missing;
    const conv = await (await fetch(`${base}/chat/conversations`, {
      method: 'POST', headers, body: JSON.stringify({}),
    })).json();
    const res = await fetch(`${base}/chat/conversations/${conv.id}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ content: 'hello coach' }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'unavailable');
    assert.match(body.error.message, /install|\/login|ANTHROPIC_API_KEY/i,
      'error must carry setup guidance');
  });
});

describe('state 2 — authenticated Claude Code subscription', () => {
  it('reports ready only after the probe verified local auth', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.ok;
    const s = await status();
    assert.equal(s.configured, true);
    assert.equal(s.state, 'ready');
    assert.equal(s.reason, null);
  });

  it('exposes backend-compatible model choices and a default', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.ok;
    const s = await status();
    assert.ok(Array.isArray(s.models) && s.models.length > 0);
    for (const m of s.models) {
      assert.ok(m.backends.includes('sdk'), `${m.id} must be servable by the active backend`);
    }
    assert.ok(s.models.some((m) => m.id === s.default_model) || typeof s.default_model === 'string');
  });

  it('never passes API credentials into the Claude Code auth-status probe', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.envSafe;
    process.env.ANTHROPIC_API_KEY = 'api-canary';
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-canary';
    try {
      const s = await status();
      assert.equal(s.configured, true,
        'the auth probe must succeed only after both Anthropic credential variables are scrubbed');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    }
  });
});

describe('state 4 — invalid/expired/undecipherable local auth', () => {
  it('expired sign-in is distinct and actionable', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.expired;
    const s = await status();
    assert.equal(s.configured, false);
    assert.equal(s.reason, 'cli_auth_expired');
    assert.match(s.setup, /\/login|sign in/i);
  });

  it('unauthenticated CLI is distinct and actionable', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.unauthenticated;
    const s = await status();
    assert.equal(s.configured, false);
    assert.equal(s.reason, 'cli_unauthenticated');
  });

  it('malformed CLI output is never mistaken for configured', async () => {
    process.env.HELM_CLAUDE_BIN = CLI.garbage;
    const s = await status();
    assert.equal(s.configured, false);
    assert.equal(s.reason, 'cli_error');
  });
});
