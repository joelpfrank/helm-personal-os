import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-no-ai-'));
fs.chmodSync(TMP, 0o700);
process.env.HELM_STATE_DIR = TMP;
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'data', 'test.db');
process.env.DASHBOARD_URL = 'http://127.0.0.1:1';
delete process.env.HELM_PROVIDER_PROFILE;
delete process.env.LLM_BACKEND;
fs.writeFileSync(path.join(TMP, 'provider-preferences.json'), '{"mode":"no_ai","profileId":"openai:api"}\n', { mode: 0o600 });

let server;
let base;
let headers;
let db;
let converseOnChannel;
let generateTitle;
let completeText;
let streamMessages;
let streamProfileMessages;
let runProviderTurn;
let runDueAgents;
const nativeFetch = globalThis.fetch;
let externalDispatches = 0;

before(async () => {
  const dbMod = await import('../server/src/db.js');
  db = dbMod.db;
  dbMod.runMigrations();
  const { getToken } = await import('../server/src/auth.js');
  const { createApp } = await import('../server/src/app.js');
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
  ({ converseOnChannel } = await import('../server/src/lib/channels.js'));
  ({ generateTitle, completeText, streamMessages } = await import('../server/src/lib/llm.js'));
  ({ streamProfileMessages, runProviderTurn } = await import('../server/src/lib/provider-gateway.js'));
  ({ runDueAgents } = await import('../server/src/routes/agents.js'));

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, init);
    externalDispatches += 1;
    throw new Error(`provider dispatch attempted: ${url.origin}`);
  };
});

after(() => {
  globalThis.fetch = nativeFetch;
  server?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('No-AI runtime mode', () => {
  it('keeps core Helm available while Coach status and message submission fail closed', async () => {
    const boards = await fetch(`${base}/boards`, { headers });
    assert.equal(boards.status, 200);

    const statusResponse = await fetch(`${base}/chat/status`, { headers });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.ai_mode, 'no_ai');
    assert.equal(status.configured, false);
    assert.match(status.summary, /without AI/i);

    const conversation = await (await fetch(`${base}/chat/conversations`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'No AI mode' }),
    })).json();
    const message = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ content: 'must not reach a provider' }),
    });
    assert.equal(message.status, 409);
    const body = await message.json();
    assert.match(body.error.message, /without AI|AI is disabled/i);
  });

  it('blocks the shared provider gateway before readiness or streaming', async () => {
    let statusChecks = 0;
    let streams = 0;
    const profile = {
      id: 'fake:no-ai',
      defaultModel: 'fake-model',
      models: [{ id: 'fake-model', capabilities: { text: true, tools: true } }],
      capabilities: { text: true, tools: true },
      async getStatus() { statusChecks += 1; return { configured: true, state: 'ready' }; },
      async *stream() { streams += 1; yield { type: 'done', stopReason: 'end_turn' }; },
    };

    await assert.rejects(async () => {
      for await (const _event of streamProfileMessages(profile, { messages: [] })) { /* consume */ }
    }, /without AI|AI is disabled/i);
    await assert.rejects(runProviderTurn({
      registry: { get: () => profile, resolveModel: () => ({ model: 'fake-model', fallback: false }) },
      profileId: profile.id,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'must stay local' }] }],
      runTool: async () => ({}),
    }), /without AI|AI is disabled/i);
    assert.equal(statusChecks, 0);
    assert.equal(streams, 0);
  });

  it('blocks channel Coach turns before any remote provider dispatch', async () => {
    externalDispatches = 0;
    await assert.rejects(converseOnChannel({
      channel: 'telegram', channelRef: 'synthetic-chat', senderName: 'Synthetic User', text: 'must stay local',
    }), /without AI|AI is disabled/i);
    assert.equal(externalDispatches, 0);
  });

  it('blocks title, utility, and legacy streaming completions before dispatch', async () => {
    externalDispatches = 0;
    await assert.rejects(generateTitle({ prompt: 'Synthetic title' }), /without AI|AI is disabled/i);
    assert.equal(await completeText({ prompt: 'Synthetic utility request' }), '');
    await assert.rejects(async () => {
      for await (const _event of streamMessages({
        system: 'Synthetic', messages: [{ role: 'user', content: [{ type: 'text', text: 'must stay local' }] }],
      })) { /* consume */ }
    }, /without AI|AI is disabled/i);
    assert.equal(externalDispatches, 0);
  });

  it('blocks manual and due scheduled agents without creating provider runs', async () => {
    externalDispatches = 0;
    const manual = await (await fetch(`${base}/agents`, {
      method: 'POST', headers, body: JSON.stringify({ label: 'Synthetic manual agent', kind: 'interactive' }),
    })).json();
    const manualRun = await fetch(`${base}/agents/${manual.id}/run`, { method: 'POST', headers, body: '{}' });
    assert.equal(manualRun.status, 409);

    const scheduled = await (await fetch(`${base}/agents`, {
      method: 'POST', headers, body: JSON.stringify({
        label: 'Synthetic scheduled agent', task: 'Must stay local', schedule_freq: 'hourly', enabled: true,
      }),
    })).json();
    db.prepare('UPDATE agents SET next_run_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', scheduled.id);
    await runDueAgents();
    const runs = db.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE agent_id = ?').get(scheduled.id);
    assert.equal(runs.count, 0);
    assert.equal(externalDispatches, 0);
  });
});
