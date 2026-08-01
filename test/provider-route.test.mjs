import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-route-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
process.env.DASHBOARD_URL = 'http://127.0.0.1:1';
process.env.LLM_BACKEND = 'api';
const TEST_API_KEY = ['provider', 'route', 'fake'].join('-');
process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
delete process.env.HELM_PROVIDER_PROFILE;
delete process.env.ANTHROPIC_MODEL;

const realFetch = globalThis.fetch;
const providerRequests = [];

function isAnthropicApiUrl(url) {
  try { return new URL(String(url)).hostname === 'api.anthropic.com'; } catch { return false; }
}

function sse(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

globalThis.fetch = async (url, init) => {
  if (!isAnthropicApiUrl(url)) return realFetch(url, init);
  const request = JSON.parse(init?.body || '{}');
  providerRequests.push(request);
  if (JSON.stringify(request).includes('exhaust the bounded tool loop')) {
    const id = `loop-tool-${providerRequests.length}`;
    return new Response(sse([
      { type: 'message_start', message: { model: 'claude-sonnet-5', usage: { input_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'list_today_habits' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return new Response(sse([
    { type: 'message_start', message: { model: 'claude-sonnet-5', usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'selected-adapter' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

let server;
let base;
let headers;

before(async () => {
  const dbMod = await import('../server/src/db.js');
  assert.equal(path.dirname(dbMod.db.name), TMP, `refusing to run against ${dbMod.db.name}`);
  dbMod.runMigrations();
  const { getToken } = await import('../server/src/auth.js');
  const { createApp } = await import('../server/src/app.js');
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

function parseEvents(raw) {
  return raw.split('\n\n').filter(Boolean).flatMap((chunk) => {
    const line = chunk.split('\n').find((entry) => entry.startsWith('data:'));
    if (!line) return [];
    try { return [JSON.parse(line.slice(5).trim())]; } catch { return []; }
  });
}

describe('production Coach route provider dispatch', () => {
  it('advertises the selected profile catalog and streams its adapter response end to end', async () => {
    const statusResponse = await fetch(`${base}/chat/status`, { headers });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.profile_id, 'anthropic:api');
    assert.ok(status.models.length > 0);
    assert.ok(status.models.every((model) => model.capabilities && model.backends?.includes('api')));

    const conversation = await (await fetch(`${base}/chat/conversations`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'selected adapter regression' }),
    })).json();
    providerRequests.length = 0;
    const response = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ content: 'route through the profile' }),
    });
    assert.equal(response.status, 200);
    const events = parseEvents(await response.text());
    assert.ok(events.some((event) => event.type === 'text_delta' && event.text === 'selected-adapter'));
    assert.ok(events.some((event) => event.type === 'done'));
    assert.equal(providerRequests.filter((request) => request.stream === true).length, 1);
  });

  it('has no production import or call path back to the legacy stream dispatcher', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', 'server', 'src', 'routes', 'chat.js'), 'utf8');
    assert.doesNotMatch(source, /\bstreamProviderMessages\b|\bstreamMessages\b/);
    assert.match(source, /streamProfileMessages\(ACTIVE_PROFILE,/);
  });

  it('terminates a bounded API tool loop with one finite secret-safe error event', async () => {
    const conversation = await (await fetch(`${base}/chat/conversations`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'bounded loop regression' }),
    })).json();
    providerRequests.length = 0;

    const response = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ content: 'exhaust the bounded tool loop SECRET-LOOP-CANARY' }),
    });
    assert.equal(response.status, 200);
    const events = parseEvents(await response.text());
    const terminal = events.filter((event) => event.type === 'done' || event.type === 'error');
    assert.equal(providerRequests.length, 12);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].type, 'error');
    assert.equal(typeof terminal[0].code, 'string');
    assert.equal(typeof terminal[0].message, 'string');
    assert.doesNotMatch(JSON.stringify(terminal[0]), /SECRET-LOOP-CANARY|list_today_habits|loop-tool/);
    assert.equal(events.at(-1)?.type, 'error');
  });

  it('resolves provider-executed SDK tool state from the actual result before done', async () => {
    const conversation = await (await fetch(`${base}/chat/conversations`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'sdk result regression' }),
    })).json();
    const { runSdkTurn } = await import('../server/src/routes/chat.js');
    assert.equal(typeof runSdkTurn, 'function');
    const emitted = [];
    const actualResults = new Map([
      ['sdk-tool-1', [{ type: 'text', text: '{"habits":[]}' }]],
      ['sdk-tool-2', [{ type: 'text', text: '{"goals":[]}' }]],
    ]);
    const profileStream = async function* () {
      yield { type: 'tool_start', index: '0:0', id: 'sdk-tool-1', name: 'list_today_habits' };
      yield { type: 'tool_input_delta', index: '0:0', id: 'sdk-tool-1', partialJson: '{}' };
      yield { type: 'tool_end', index: '0:0', id: 'sdk-tool-1' };
      yield { type: 'tool_result', id: 'sdk-tool-1', ok: true, result: actualResults.get('sdk-tool-1') };
      yield { type: 'tool_start', index: '1:0', id: 'sdk-tool-2', name: 'list_goals' };
      yield { type: 'tool_input_delta', index: '1:0', id: 'sdk-tool-2', partialJson: '{}' };
      yield { type: 'tool_end', index: '1:0', id: 'sdk-tool-2' };
      yield { type: 'tool_result', id: 'sdk-tool-2', ok: true, result: actualResults.get('sdk-tool-2') };
      yield { type: 'text_delta', text: 'complete' };
      yield { type: 'done', stopReason: 'end_turn' };
    };

    await runSdkTurn({
      id: conversation.id,
      send: (event) => emitted.push(event),
      systemPrompt: 'test only',
      workingMessages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      model: 'claude-sonnet-5',
      simplifiedTools: true,
      profileStream,
    });

    const done = emitted.findIndex((event) => event.type === 'done');
    for (const [id, actualResult] of actualResults) {
      const started = emitted.findIndex((event) => event.type === 'tool_start' && event.id === id);
      const input = emitted.findIndex((event) => event.type === 'tool_input' && event.id === id);
      const results = emitted.filter((event) => event.type === 'tool_result' && event.id === id);
      const result = emitted.findIndex((event) => event === results[0]);
      assert.ok(started >= 0 && started < input && input < result && result < done);
      assert.deepEqual(results, [{ type: 'tool_result', id, ok: true, result: actualResult }]);
    }
    const unresolved = emitted
      .filter((event) => event.type === 'tool_start')
      .filter((start) => !emitted.some((event) => event.type === 'tool_result' && event.id === start.id));
    assert.deepEqual(unresolved, []);
  });

  it('rejects missing or fabricated SDK terminal tool results without emitting done', async () => {
    const conversation = await (await fetch(`${base}/chat/conversations`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'sdk unresolved regression' }),
    })).json();
    const { runSdkTurn } = await import('../server/src/routes/chat.js');

    for (const terminalEvent of [
      null,
      { type: 'tool_result', id: 'sdk-tool-missing', ok: true },
    ]) {
      const emitted = [];
      const profileStream = async function* () {
        yield { type: 'tool_start', index: '0:0', id: 'sdk-tool-missing', name: 'list_today_habits' };
        yield { type: 'tool_input_delta', index: '0:0', id: 'sdk-tool-missing', partialJson: '{}' };
        yield { type: 'tool_end', index: '0:0', id: 'sdk-tool-missing' };
        if (terminalEvent) yield terminalEvent;
        yield { type: 'done', stopReason: 'end_turn' };
      };

      await assert.rejects(runSdkTurn({
        id: conversation.id,
        send: (event) => emitted.push(event),
        systemPrompt: 'test only',
        workingMessages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        model: 'claude-sonnet-5',
        simplifiedTools: true,
        profileStream,
      }), /tool result/i);
      assert.equal(emitted.some((event) => event.type === 'done'), false);
    }
  });
});
