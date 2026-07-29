// TDD tests: first-run/auth safety on the 'api' backend, driven through the
// real Express app with a MOCKED Anthropic endpoint. RED first — SSE error
// redaction and the deterministic model fallback must FAIL before chat.js is
// wired to the taxonomy/capability layers.
//
// ISOLATION CONTRACT:
//   • DASHBOARD_DB_PATH + LLM_BACKEND=api are set at MODULE SCOPE before any
//     server import.
//   • global fetch is wrapped: any request to api.anthropic.com is served
//     from an in-process mock — no live or paid provider call can occur.
//     All other URLs (our own test server) pass through untouched.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-auth-api-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
process.env.DASHBOARD_URL = 'http://127.0.0.1:1';
process.env.LLM_BACKEND = 'api';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_MODEL;

// Secret-shaped canaries, constructed so repo secret scanners never see a
// key-shaped literal. If either string ever reaches a client surface, the
// redaction layer is broken.
const CANARY_KEY = ['sk', 'ant', 'api03', 'CANARY'.repeat(5)].join('-');
const CANARY_WORD = 'XYZZY-CANARY-VALUE';
const TEST_API_KEY = ['canary', 'key', '1234'].join('-');

// ── Anthropic endpoint mock ────────────────────────────────────────
const realFetch = globalThis.fetch;
let anthropicMode = 'auth-error'; // 'auth-error' | 'rate-limit' | 'success'
const anthropicRequests = [];

function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
const SUCCESS_STREAM = sse([
  { type: 'message_start', message: { usage: { input_tokens: 1 }, model: 'claude-sonnet-5' } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
]);

// Exact-hostname check (not a substring test) so a URL like
// "https://evil.example/api.anthropic.com" or
// "https://api.anthropic.com.evil.example" can never be misrouted to the
// mock (CodeQL js/incomplete-url-substring-sanitization).
function isAnthropicApiUrl(url) {
  try {
    return new URL(String(url)).hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}

globalThis.fetch = async (url, init) => {
  if (!isAnthropicApiUrl(url)) return realFetch(url, init);
  anthropicRequests.push(JSON.parse(init?.body ?? '{}'));
  if (anthropicMode === 'auth-error') {
    return new Response(JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: `invalid x-api-key ${CANARY_KEY} (${CANARY_WORD})` },
    }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  if (anthropicMode === 'rate-limit') {
    return new Response(JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: `slow down ${CANARY_WORD}` },
    }), { status: 429, headers: { 'content-type': 'application/json' } });
  }
  return new Response(SUCCESS_STREAM, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

let server, base, headers, db;

before(async () => {
  const dbMod = await import('../server/src/db.js');
  assert.equal(path.dirname(dbMod.db.name), TMP,
    `refusing to run: db.js opened ${dbMod.db.name}, not the isolated test DB`);
  dbMod.runMigrations();
  db = dbMod.db;
  const { getToken } = await import('../server/src/auth.js');
  const { createApp } = await import('../server/src/app.js');
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
});

after(() => { server?.close(); globalThis.fetch = realFetch; });

async function status() {
  const res = await fetch(`${base}/chat/status`, { headers });
  assert.equal(res.status, 200);
  return res.json();
}

async function newConversation() {
  return (await fetch(`${base}/chat/conversations`, {
    method: 'POST', headers, body: JSON.stringify({}),
  })).json();
}

// POST a message and return { raw, events } from the SSE response.
async function sendMessage(convId, text) {
  const res = await fetch(`${base}/chat/conversations/${convId}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ content: text }),
  });
  const raw = await res.text();
  const events = raw.split('\n\n').filter(Boolean).flatMap((chunk) => {
    const line = chunk.split('\n').find((l) => l.startsWith('data:'));
    if (!line) return [];
    try { return [JSON.parse(line.slice(5).trim())]; } catch { return []; }
  });
  return { res, raw, events };
}

describe('api backend without a key', () => {
  it('reports api_key_missing and keeps core routes usable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const s = await status();
    assert.equal(s.backend, 'api');
    assert.equal(s.configured, false);
    assert.equal(s.reason, 'api_key_missing');
    assert.match(s.setup, /ANTHROPIC_API_KEY/);
    const boards = await fetch(`${base}/boards`, { headers });
    assert.equal(boards.status, 200);
  });

  it('rejects a coach message with safe setup guidance', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const conv = await newConversation();
    const res = await fetch(`${base}/chat/conversations/${conv.id}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ content: 'hi' }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'unavailable');
    assert.match(body.error.message, /ANTHROPIC_API_KEY/);
  });
});

describe('state 3 — api backend with ANTHROPIC_API_KEY', () => {
  it('reports ready without exposing the key value anywhere', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    const s = await status();
    assert.equal(s.configured, true);
    assert.equal(s.state, 'ready');
    assert.doesNotMatch(JSON.stringify(s), /canary-key-1234/);
  });
});

describe('state 4 — invalid/expired API auth (mocked 401)', () => {
  it('streams a classified auth error; raw provider text and canaries never reach the client', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'auth-error';
    const conv = await newConversation();
    const { raw, events } = await sendMessage(conv.id, 'hello');
    const errEvent = events.find((e) => e.type === 'error');
    assert.ok(errEvent, 'an SSE error event must be emitted');
    assert.equal(errEvent.code, 'auth');
    assert.match(errEvent.message, /\/login|ANTHROPIC_API_KEY/i, 'auth error must be actionable');
    assert.ok(!raw.includes(CANARY_KEY), 'key material must never reach the stream');
    assert.ok(!raw.includes(CANARY_WORD), 'raw provider body must never reach the stream');
    assert.ok(!raw.includes('sk-ant'), 'nothing key-shaped on the stream');
  });

  it('never persists raw provider errors into stored chat messages', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'auth-error';
    const conv = await newConversation();
    await sendMessage(conv.id, 'hello again');
    const stored = await (await fetch(`${base}/chat/conversations/${conv.id}`, { headers })).text();
    assert.ok(!stored.includes(CANARY_KEY));
    assert.ok(!stored.includes(CANARY_WORD));
  });

  it('classifies rate limiting distinctly', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'rate-limit';
    const conv = await newConversation();
    const { raw, events } = await sendMessage(conv.id, 'hello');
    const errEvent = events.find((e) => e.type === 'error');
    assert.equal(errEvent?.code, 'rate_limit');
    assert.ok(!raw.includes(CANARY_WORD));
  });
});

describe('server logs never carry raw provider text or secrets', () => {
  // Arbitrary user/provider-supplied secrets cannot be reliably pattern-
  // matched (that's exactly how CANARY_WORD slips past a shape-based
  // redactor), so the only safe contract is: never log raw provider
  // message/body/stack text at all — only finite classified metadata.
  it('logs no canary, no raw provider message/body, and nothing key-shaped on a mocked auth failure', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'auth-error';
    const conv = await newConversation();

    const realError = console.error;
    const realWarn = console.warn;
    const logged = [];
    console.error = (...args) => { logged.push(args.map(String).join(' ')); };
    console.warn = (...args) => { logged.push(args.map(String).join(' ')); };
    try {
      await sendMessage(conv.id, 'hello once more');
    } finally {
      console.error = realError;
      console.warn = realWarn;
    }

    const combined = logged.join('\n');
    assert.ok(!combined.includes(CANARY_KEY), 'CANARY_KEY must never be logged');
    assert.ok(!combined.includes(CANARY_WORD), 'CANARY_WORD must never be logged');
    assert.ok(!combined.includes('invalid x-api-key'), 'raw provider message text must never be logged');
    assert.ok(!combined.includes('authentication_error'), 'raw provider body must never be logged');
    assert.doesNotMatch(combined, /sk-ant/, 'nothing key-shaped may appear in logs');
    assert.ok(!combined.includes(TEST_API_KEY), 'the configured API key must never be logged');
  });
});

describe('/chat/status resolves default_model through the deterministic backend resolver', () => {
  it('a stale settings.default_model never reaches the client unresolved', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    db.prepare('UPDATE chat_settings SET default_model = ? WHERE id = 1').run('claude-3-5-sonnet-legacy');
    try {
      const s = await status();
      const { DEFAULT_MODEL_ID } = await import('../server/src/lib/coach-models.js');
      assert.equal(s.default_model, DEFAULT_MODEL_ID,
        'an incompatible/stale stored default must resolve to the documented fallback, not pass through raw');
      assert.ok(s.models.some((m) => m.id === s.default_model));
    } finally {
      db.prepare('UPDATE chat_settings SET default_model = NULL WHERE id = 1').run();
    }
  });
});

describe('model compatibility on the wire', () => {
  it('uses the same explicit default model advertised by /chat/status when nothing is stored', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'success';
    const advertised = await status();
    const conv = await newConversation();
    anthropicRequests.length = 0;
    const { events } = await sendMessage(conv.id, 'default model please');
    assert.ok(events.some((e) => e.type === 'done'), 'turn must complete');
    const chatCall = anthropicRequests.find((r) => r.stream === true);
    assert.equal(chatCall?.model, advertised.default_model,
      'the wire model must match the default model shown to the user');
  });

  it('a stale stored model resolves to the documented deterministic fallback, not a silent failure', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'success';
    const conv = await newConversation();
    // Simulate a model stored before the picker dropped it (the PATCH API
    // rejects unknown ids, so write directly like an old DB row would look).
    db.prepare('UPDATE chat_conversations SET model = ? WHERE id = ?')
      .run('claude-3-5-sonnet-legacy', conv.id);
    anthropicRequests.length = 0;
    const { events } = await sendMessage(conv.id, 'hi');
    assert.ok(events.some((e) => e.type === 'done'), 'turn must complete');
    const chatCall = anthropicRequests.find((r) => r.stream === true);
    assert.ok(chatCall, 'a chat request must reach the (mocked) provider');
    assert.notEqual(chatCall.model, 'claude-3-5-sonnet-legacy',
      'the unavailable model must not be passed through silently');
    const { DEFAULT_MODEL_ID } = await import('../server/src/lib/coach-models.js');
    assert.equal(chatCall.model, DEFAULT_MODEL_ID, 'fallback is deterministic and documented');
  });

  it('never writes an arbitrary stale model identifier into server logs', async () => {
    process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
    anthropicMode = 'success';
    const conv = await newConversation();
    db.prepare('UPDATE chat_conversations SET model = ? WHERE id = ?').run(CANARY_WORD, conv.id);
    const realWarn = console.warn;
    const logged = [];
    console.warn = (...args) => { logged.push(args.map(String).join(' ')); };
    try {
      await sendMessage(conv.id, 'do not log stale identifiers');
    } finally {
      console.warn = realWarn;
    }
    assert.ok(!logged.join('\n').includes(CANARY_WORD),
      'fallback logging must use fixed metadata, never the stored model value');
  });
});
