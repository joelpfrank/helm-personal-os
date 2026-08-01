import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// sdkToolResultEvents is exported by the production Claude Code runtime, which
// imports the external MCP registry and therefore opens Helm's database. Fence
// that import into disposable state before any provider module is evaluated.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-stream-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

const {
  normalizeAnthropicStream,
  createNormalizedAccumulator,
} = await import('../server/src/lib/provider-stream.js');
const { runProviderTurn, assertProfileSupportsRequest } = await import('../server/src/lib/provider-gateway.js');
const { createProviderProfile } = await import('../server/src/lib/providers/contract.js');
const { createProviderRegistry } = await import('../server/src/lib/providers/registry.js');

async function* events(items) { yield* items; }

const ANTHROPIC_FIXTURE = [
  { type: 'message_start', message: { model: 'fixture-model', usage: { input_tokens: 3 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'list_today' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"day":"today"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
  { type: 'message_stop' },
];

describe('normalized stream contract', () => {
  it('extracts only actual SDK tool execution results from user-role result messages', async () => {
    const { sdkToolResultEvents } = await import('../server/src/lib/provider-claude-code-runtime.js');
    assert.equal(typeof sdkToolResultEvents, 'function');
    const actualResult = [{ type: 'text', text: '{"habits":[]}' }];
    assert.deepEqual(sdkToolResultEvents({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sdk-tool-1', content: actualResult }] },
      parent_tool_use_id: null,
      tool_use_result: { internal: 'SDK-METADATA-MUST-NOT-BE-EMITTED' },
    }), [{ type: 'sdk_tool_result', id: 'sdk-tool-1', ok: true, result: actualResult }]);
    assert.deepEqual(sdkToolResultEvents({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'sdk-tool-1' }] },
      tool_use_result: { fabricated: 'PLACEHOLDER-MUST-NOT-BE-EMITTED' },
    }), []);
  });

  it('requires every SDK tool to have one ordered actual result before done', async () => {
    const valid = [];
    for await (const event of normalizeAnthropicStream(events([
      { type: 'content_block_start', index: '0:0', content_block: { type: 'tool_use', id: 'sdk-tool-1', name: 'lookup' } },
      { type: 'content_block_delta', index: '0:0', delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: '0:0' },
      { type: 'sdk_tool_result', id: 'sdk-tool-1', ok: true, result: [{ type: 'text', text: 'actual' }] },
      { type: 'message_stop' },
    ]), { requireToolResults: true })) valid.push(event);
    assert.deepEqual(valid.at(-2), {
      type: 'tool_result', id: 'sdk-tool-1', ok: true, result: [{ type: 'text', text: 'actual' }],
    });

    await assert.rejects(async () => {
      for await (const _event of normalizeAnthropicStream(events([
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'missing-result', name: 'lookup' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]), { requireToolResults: true })) { /* consume */ }
    }, /tool result/i);

    await assert.rejects(async () => {
      for await (const _event of normalizeAnthropicStream(events([
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'out-of-order', name: 'lookup' } },
        { type: 'sdk_tool_result', id: 'out-of-order', ok: true, result: 'placeholder' },
      ]), { requireToolResults: true })) { /* consume */ }
    }, /ordering/i);
  });

  it('converts Anthropic text, tool, usage, and stop events without provider-shaped leakage', async () => {
    const normalized = [];
    for await (const event of normalizeAnthropicStream(events(ANTHROPIC_FIXTURE))) normalized.push(event);
    assert.deepEqual(normalized, [
      { type: 'usage', usage: { inputTokens: 3 }, model: 'fixture-model' },
      { type: 'text_delta', text: 'hello' },
      { type: 'tool_start', index: 1, id: 'tool-1', name: 'list_today' },
      { type: 'tool_input_delta', index: 1, id: 'tool-1', partialJson: '{"day":"today"}' },
      { type: 'tool_end', index: 1, id: 'tool-1' },
      { type: 'usage', usage: { outputTokens: 4 } },
      { type: 'done', stopReason: 'tool_use' },
    ]);
    assert.equal(JSON.stringify(normalized).includes('content_block'), false);
  });

  it('normalizes provider errors to a finite secret-safe shape', async () => {
    const normalized = [];
    for await (const event of normalizeAnthropicStream(events([{
      type: 'error',
      error: { status: 401, message: 'ADAPTER-SECRET-CANARY', body: { token: 'ADAPTER-SECRET-CANARY' } },
    }]))) normalized.push(event);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].type, 'provider_error');
    assert.equal(normalized[0].error.code, 'auth');
    assert.doesNotMatch(JSON.stringify(normalized), /ADAPTER-SECRET-CANARY|token/);
  });

  it('assembles normalized events into provider-independent text/tool content and usage', () => {
    const accumulator = createNormalizedAccumulator();
    for (const event of [
      { type: 'usage', usage: { inputTokens: 3 }, model: 'fake-model' },
      { type: 'text_delta', text: 'hello' },
      { type: 'tool_start', index: 1, id: 't1', name: 'lookup' },
      { type: 'tool_input_delta', index: 1, id: 't1', partialJson: '{"q":"x"}' },
      { type: 'tool_end', index: 1, id: 't1' },
      { type: 'usage', usage: { outputTokens: 2 } },
      { type: 'done', stopReason: 'tool_use' },
    ]) accumulator.onEvent(event);
    assert.deepEqual(accumulator.finalize(), {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_call', id: 't1', name: 'lookup', input: { q: 'x' } },
      ],
      model: 'fake-model', stopReason: 'tool_use', usage: { inputTokens: 3, outputTokens: 2 },
    });
  });

  it('rejects malformed tool JSON, invalid ordering, and streams without done', () => {
    const malformed = createNormalizedAccumulator();
    malformed.onEvent({ type: 'tool_start', index: 0, id: 't1', name: 'lookup' });
    malformed.onEvent({ type: 'tool_input_delta', index: 0, id: 't1', partialJson: '{bad' });
    assert.throws(() => malformed.onEvent({ type: 'tool_end', index: 0, id: 't1' }), /tool JSON/i);

    const outOfOrder = createNormalizedAccumulator();
    assert.throws(() => outOfOrder.onEvent({ type: 'tool_input_delta', index: 7, id: 'missing', partialJson: '{}' }), /ordering/i);

    const incomplete = createNormalizedAccumulator();
    incomplete.onEvent({ type: 'text_delta', text: 'partial' });
    assert.throws(() => incomplete.finalize(), /done/i);
  });
});

describe('fake provider gateway', () => {
  it('switches by profile, executes normalized tool calls, and feeds normalized results into the next turn', async () => {
    const requests = [];
    const fake = createProviderProfile({
      id: 'fake:tools', providerId: 'fake', label: 'Fake', authClass: 'api_key',
      capabilities: { text: true, tools: true },
      models: [{ id: 'fake-model', label: 'Fake', capabilities: { text: true, tools: true } }],
      defaultModel: 'fake-model', status: async () => ({ configured: true, state: 'ready' }),
      stream: async function* (request) {
        requests.push(structuredClone(request));
        if (requests.length === 1) {
          yield { type: 'tool_start', index: 0, id: 't1', name: 'lookup' };
          yield { type: 'tool_input_delta', index: 0, id: 't1', partialJson: '{"q":"helm"}' };
          yield { type: 'tool_end', index: 0, id: 't1' };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'text_delta', text: 'finished' };
          yield { type: 'done', stopReason: 'end_turn', usage: { outputTokens: 1 } };
        }
      },
    });
    const emitted = [];
    const result = await runProviderTurn({
      registry: createProviderRegistry([fake]), profileId: 'fake:tools', model: null,
      system: 'safe', messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }], tools: [{ name: 'lookup' }],
      runTool: async (name, input) => ({ name, input, found: true }),
      onEvent: (event) => emitted.push(event),
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].messages.at(-1), {
      role: 'tool', toolCallId: 't1', name: 'lookup', content: { name: 'lookup', input: { q: 'helm' }, found: true }, isError: false,
    });
    assert.equal(result.text, 'finished');
    assert.ok(emitted.some((event) => event.type === 'tool_result' && event.ok === true));
  });

  it('fails before streaming when the selected profile lacks required capabilities', async () => {
    const profile = createProviderProfile({
      id: 'fake:text', providerId: 'fake', label: 'Fake', authClass: 'api_key',
      capabilities: { text: true, tools: false }, models: [{ id: 'text', label: 'Text', capabilities: { text: true } }],
      defaultModel: 'text', status: async () => ({ configured: true, state: 'ready' }),
      stream: async function* () { throw new Error('must not run'); },
    });
    await assert.rejects(runProviderTurn({
      registry: createProviderRegistry([profile]), profileId: 'fake:text', messages: [], tools: [{ name: 'lookup' }], runTool: async () => ({}),
    }), /tools capability/i);
  });

  it('enforces selected model capabilities as well as profile capabilities before dispatch', async () => {
    let streamed = false;
    const profile = createProviderProfile({
      id: 'fake:mixed', providerId: 'fake', label: 'Fake', authClass: 'api_key',
      capabilities: { text: true, tools: true, vision: true },
      models: [{ id: 'text-only', label: 'Text only', capabilities: { text: true } }],
      defaultModel: 'text-only', status: async () => ({ configured: true, state: 'ready' }),
      stream: async function* () { streamed = true; yield { type: 'done', stopReason: 'end_turn' }; },
    });
    await assert.rejects(runProviderTurn({
      registry: createProviderRegistry([profile]), profileId: profile.id, model: 'text-only',
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'AA==' } }] }],
      tools: [], runTool: async () => ({}),
    }), /model.*vision capability/i);
    assert.equal(streamed, false);
  });

  it('gates Coach attachments against the selected profile capabilities', () => {
    const profile = {
      id: 'fake:text',
      capabilities: { text: true, tools: false, vision: false, documents: false },
      defaultModel: 'text',
      models: [{ id: 'text', capabilities: { text: true, tools: false, vision: false, documents: false } }],
    };
    assert.throws(() => assertProfileSupportsRequest(profile, {
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'AA==' } }] }],
      tools: [],
    }), /vision capability/i);
    assert.throws(() => assertProfileSupportsRequest(profile, {
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', data: 'AA==' } }] }],
      tools: [],
    }), /documents capability/i);
  });
});
