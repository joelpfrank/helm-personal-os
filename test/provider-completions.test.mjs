import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { completeProfileText } = await import('../server/src/lib/provider-completions.js');

describe('provider-neutral utility completion', () => {
  it('uses only the selected ready profile and its compatible default model', async () => {
    const requests = [];
    const profile = {
      id: 'fixture:api',
      defaultModel: 'fixture-default',
      models: [{ id: 'fixture-default' }, { id: 'fixture-fast' }],
      getStatus: async () => ({ configured: true, state: 'ready' }),
      stream: async function* (request) {
        requests.push(request);
        yield { type: 'text_delta', text: ' selected ' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };

    assert.equal(await completeProfileText(profile, {
      system: 'minimum context', prompt: 'summarize', model: 'foreign-model', maxTokens: 40,
    }), 'selected');
    assert.deepEqual(requests, [{
      system: 'minimum context',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'summarize' }] }],
      tools: [],
      model: 'fixture-default',
      maxTokens: 40,
    }]);
  });

  it('fails closed without dispatch when the selected profile is not ready', async () => {
    let streams = 0;
    const profile = {
      id: 'fixture:missing', defaultModel: 'fixture', models: [{ id: 'fixture' }],
      getStatus: async () => ({ configured: false, state: 'unconfigured' }),
      stream: async function* () { streams += 1; yield { type: 'done', stopReason: 'end_turn' }; },
    };
    assert.equal(await completeProfileText(profile, { prompt: 'do not send' }), '');
    assert.equal(streams, 0);
  });

  it('returns no text for malformed, tool-using, or failed utility streams', async () => {
    for (const events of [
      [{ type: 'provider_error', error: { code: 'auth', message: 'safe' } }],
      [{ type: 'tool_start', index: 0, id: 't1', name: 'forbidden' }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text_delta', text: 'partial' }],
    ]) {
      const profile = {
        id: 'fixture:bad', defaultModel: 'fixture', models: [{ id: 'fixture' }],
        getStatus: async () => ({ configured: true, state: 'ready' }),
        stream: async function* () { yield* events; },
      };
      assert.equal(await completeProfileText(profile, { prompt: 'safe' }), '');
    }
  });

  it('routes utility completions and titles through the active profile instead of Anthropic-only API calls', () => {
    const source = fs.readFileSync(path.join(ROOT, 'server/src/lib/llm.js'), 'utf8');
    assert.match(source, /completeProfileText\(ACTIVE_PROFILE/);
    assert.doesNotMatch(source, /apiCreate\(|hasApiKey\(/);
  });

  it('maps the normalized utility token bound into the Anthropic API contract', () => {
    const source = fs.readFileSync(path.join(ROOT, 'server/src/lib/providers/anthropic-api.js'), 'utf8');
    assert.match(source, /max_tokens:\s*request\.maxTokens/);
  });
});
