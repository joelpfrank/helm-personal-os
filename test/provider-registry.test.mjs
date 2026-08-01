import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Importing the production Claude Code profile reaches the MCP runtime, whose
// external-server registry opens Helm's database. Keep that eager production
// import inside a disposable state boundary so the test suite can never create
// server/data in the public working tree.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-registry-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

const {
  AUTH_CLASSES,
  CAPABILITY_KEYS,
  backendKindForProfile,
  createProviderProfile,
} = await import('../server/src/lib/providers/contract.js');
const {
  createProviderRegistry,
  resolveActiveProfileId,
} = await import('../server/src/lib/providers/registry.js');
const { CLAUDE_CODE_PROFILE } = await import('../server/src/lib/providers/claude-code.js');
const { ANTHROPIC_API_PROFILE } = await import('../server/src/lib/providers/anthropic-api.js');

function fakeProfile(overrides = {}) {
  return createProviderProfile({
    id: 'fake:test',
    providerId: 'fake',
    label: 'Fake provider',
    authClass: 'api_key',
    models: [
      { id: 'fake-balanced', label: 'Balanced', capabilities: { text: true, tools: true } },
      { id: 'fake-text', label: 'Text', capabilities: { text: true } },
    ],
    defaultModel: 'fake-balanced',
    capabilities: { text: true, tools: true, vision: false, documents: false, web: false, subscriptionLogin: false },
    status: async () => ({ configured: true, state: 'ready', reason: null }),
    stream: async function* () { yield { type: 'text_delta', text: 'ok' }; yield { type: 'done', stopReason: 'end_turn', usage: null }; },
    ...overrides,
  });
}

describe('provider profile contract', () => {
  it('normalizes identity, authentication, capabilities, models, and safe readiness', async () => {
    assert.deepEqual(AUTH_CLASSES, ['api_key', 'subscription_cli']);
    assert.deepEqual(CAPABILITY_KEYS, ['text', 'vision', 'documents', 'tools', 'web', 'subscriptionLogin']);
    const profile = fakeProfile();
    assert.equal(profile.id, 'fake:test');
    assert.equal(profile.authClass, 'api_key');
    assert.deepEqual(profile.capabilities, {
      text: true, vision: false, documents: false, tools: true, web: false, subscriptionLogin: false,
    });
    assert.equal((await profile.getStatus()).profileId, 'fake:test');
    assert.equal((await profile.getStatus()).providerId, 'fake');
    assert.equal(JSON.stringify(await profile.getStatus()).includes('secret'), false);
  });

  it('fails closed on malformed profiles and readiness responses', async () => {
    assert.throws(() => fakeProfile({ id: '../escape' }), /profile id/i);
    assert.throws(() => fakeProfile({ defaultModel: 'missing' }), /default model/i);
    const profile = fakeProfile({ status: async () => ({ configured: true, state: 'ready', secret: 'CANARY' }) });
    await assert.rejects(profile.getStatus(), /status keys/i);
  });

  it('rejects unknown readiness reasons and adapter-controlled presentation text', async () => {
    const unknown = fakeProfile({ status: async () => ({ configured: false, state: 'unconfigured', reason: 'ADAPTER-SECRET-CANARY' }) });
    await assert.rejects(unknown.getStatus(), /reason/i);
    const presentation = fakeProfile({
      status: async () => ({ configured: false, state: 'unconfigured', reason: 'api_key_missing', summary: 'ADAPTER-SECRET-CANARY' }),
    });
    await assert.rejects(presentation.getStatus(), /status keys/i);
  });
});

describe('provider registry and compatibility', () => {
  it('registers profiles uniquely and resolves fallback only inside the selected profile', () => {
    const registry = createProviderRegistry([fakeProfile(), fakeProfile({ id: 'fake:other', defaultModel: 'other-default', models: [
      { id: 'other-default', label: 'Other', capabilities: { text: true } },
    ] })]);
    assert.deepEqual(registry.list().map((p) => p.id), ['fake:test', 'fake:other']);
    assert.deepEqual(registry.resolveModel('fake:test', 'fake-text'), { model: 'fake-text', fallback: false });
    assert.deepEqual(registry.resolveModel('fake:test', 'other-default'), {
      model: 'fake-balanced', fallback: true, requested: 'other-default',
    });
    assert.throws(() => createProviderRegistry([fakeProfile(), fakeProfile()]), /duplicate/i);
  });

  it('maps legacy backend selection deterministically to preserved Anthropic profiles', () => {
    assert.equal(resolveActiveProfileId({}), 'anthropic:claude-code');
    assert.equal(resolveActiveProfileId({ LLM_BACKEND: 'api' }), 'anthropic:api');
    assert.equal(resolveActiveProfileId({ HELM_PROVIDER_PROFILE: 'fake:test', LLM_BACKEND: 'api' }), 'fake:test');
    assert.equal(CLAUDE_CODE_PROFILE.id, 'anthropic:claude-code');
    assert.equal(ANTHROPIC_API_PROFILE.id, 'anthropic:api');
  });

  it('registers the verified major API profiles in the production registry', async () => {
    const { providerRegistry } = await import('../server/src/lib/providers/registry.js');
    assert.deepEqual(providerRegistry.list().map((profile) => profile.id), [
      'anthropic:claude-code',
      'openai:codex-cli',
      'anthropic:api',
      'openai:api',
      'google:gemini-api',
      'openrouter:api',
    ]);
  });

  it('classifies every API-key profile as the API backend for status and routing compatibility', async () => {
    const { providerRegistry } = await import('../server/src/lib/providers/registry.js');
    for (const id of ['anthropic:api', 'openai:api', 'google:gemini-api', 'openrouter:api']) {
      assert.equal(backendKindForProfile(providerRegistry.get(id)), 'api');
    }
    assert.equal(backendKindForProfile(providerRegistry.get('anthropic:claude-code')), 'sdk');
  });
});
