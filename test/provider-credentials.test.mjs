import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

function tempState(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(root, 0o700);
  return root;
}

// Importing the production registry also reaches the preserved Claude Code
// MCP tool graph, which opens the database at module load. Keep that side
// effect in disposable state rather than creating server/data in public source.
const MODULE_STATE = tempState('helm-module-state-');
process.env.HELM_STATE_DIR = MODULE_STATE;
process.env.DASHBOARD_DB_PATH = path.join(MODULE_STATE, 'data', 'test.db');
after(() => fs.rmSync(MODULE_STATE, { recursive: true, force: true }));

async function listen(router) {
  const app = express();
  app.use(express.json());
  app.use('/providers', router);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: { code: error.code || 'internal', message: error.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/providers` };
}

function profile({ id, providerId, label, authClass, status }) {
  return {
    id,
    providerId,
    label,
    authClass,
    capabilities: { text: true, tools: true, vision: false, documents: false, web: false, subscriptionLogin: authClass === 'subscription_cli' },
    models: [{ id: `${providerId}-model`, label: `${label} model`, capabilities: { text: true, tools: true } }],
    defaultModel: `${providerId}-model`,
    getStatus: async () => status,
  };
}

describe('Provider credentials and restart-safe selection', () => {
  it('resolves a stored API credential internally while the public store remains write-only', async () => {
    const root = tempState('helm-secret-');
    try {
      const { createProviderSecretStore, resolveProviderCredential } = await import('../server/src/lib/provider-secrets.js');
      const store = createProviderSecretStore({ env: { HELM_STATE_DIR: root } });
      store.put('openai:api', 'STORED-CANARY');
      assert.equal(typeof store.read, 'undefined');
      assert.equal(resolveProviderCredential('openai:api', { HELM_STATE_DIR: root }), 'STORED-CANARY');
      assert.equal(resolveProviderCredential('openai:api', { HELM_STATE_DIR: root, OPENAI_API_KEY: 'ENV-CANARY' }), 'ENV-CANARY');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists no-AI or a known profile without putting provider choice in SQLite', async () => {
    const root = tempState('helm-preferences-');
    try {
      const { createProviderPreferences } = await import('../server/src/lib/provider-preferences.js');
      const preferences = createProviderPreferences({ env: { HELM_STATE_DIR: root }, knownProfileIds: ['openai:api'] });
      assert.deepEqual(preferences.get(), { mode: 'provider', profileId: null });
      assert.deepEqual(preferences.set({ mode: 'provider', profileId: 'openai:api' }), { mode: 'provider', profileId: 'openai:api' });
      assert.deepEqual(preferences.set({ mode: 'no_ai' }), { mode: 'no_ai', profileId: 'openai:api' });
      assert.throws(() => preferences.set({ mode: 'provider', profileId: 'unknown:api' }), /unknown provider profile/i);
      const raw = fs.readFileSync(path.join(root, 'provider-preferences.json'), 'utf8');
      assert.doesNotMatch(raw, /credential|secret|key/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('makes UI-saved credentials available to every API adapter without exposing them through status', async () => {
    const root = tempState('helm-adapters-');
    const previous = process.env.HELM_STATE_DIR;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.HELM_STATE_DIR = root;
    try {
      const { createProviderSecretStore } = await import('../server/src/lib/provider-secrets.js');
      const store = createProviderSecretStore();
      for (const id of ['anthropic:api', 'openai:api', 'google:gemini-api', 'openrouter:api']) store.put(id, `${id}-CANARY`);
      const [{ hasApiKey }, { createOpenAiApiProfile }, { createGeminiApiProfile }, { createOpenRouterApiProfile }] = await Promise.all([
        import('../server/src/lib/anthropic.js'),
        import('../server/src/lib/providers/openai-api.js'),
        import('../server/src/lib/providers/gemini-api.js'),
        import('../server/src/lib/providers/openrouter-api.js'),
      ]);
      assert.equal(hasApiKey(), true);
      for (const adapter of [createOpenAiApiProfile(), createGeminiApiProfile(), createOpenRouterApiProfile()]) {
        const status = await adapter.getStatus();
        assert.equal(status.configured, true, `${adapter.id} must consume the protected stored credential`);
        assert.doesNotMatch(JSON.stringify(status), /CANARY/);
      }
    } finally {
      if (previous == null) delete process.env.HELM_STATE_DIR;
      else process.env.HELM_STATE_DIR = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves the persisted no-AI/provider mode at process start while explicit operations overrides win', async () => {
    const { resolveProviderSelection } = await import('../server/src/lib/providers/registry.js');
    const noAi = { get: () => ({ mode: 'no_ai', profileId: 'openai:api' }) };
    assert.deepEqual(resolveProviderSelection({}, noAi), { mode: 'no_ai', profileId: 'openai:api' });
    assert.deepEqual(resolveProviderSelection({ HELM_PROVIDER_PROFILE: 'google:gemini-api' }, noAi), {
      mode: 'provider', profileId: 'google:gemini-api',
    });
  });
});

describe('Provider settings API', () => {
  it('keeps a first-run no-AI selection active before any provider has been chosen', async () => {
    const root = tempState('helm-first-no-ai-');
    const previous = process.env.HELM_STATE_DIR;
    process.env.HELM_STATE_DIR = root;
    const { createProviderSettingsRouter } = await import('../server/src/routes/providers.js');
    const { server, base } = await listen(createProviderSettingsRouter());
    try {
      let response = await fetch(`${base}/selection`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'no_ai' }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { mode: 'no_ai', profile_id: null, restart_required: true });

      response = await fetch(base);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.mode, 'no_ai');
      assert.equal(body.selected_profile_id, null);
    } finally {
      server.close();
      if (previous == null) delete process.env.HELM_STATE_DIR;
      else process.env.HELM_STATE_DIR = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists setup metadata in persisted no-AI mode without readiness or credential-status work', async () => {
    let readinessChecks = 0;
    let credentialStatusChecks = 0;
    const cli = profile({
      id: 'anthropic:claude-code', providerId: 'anthropic', label: 'Claude Code', authClass: 'subscription_cli',
      status: { configured: true, state: 'ready' },
    });
    const api = profile({
      id: 'openai:api', providerId: 'openai', label: 'OpenAI API', authClass: 'api_key',
      status: { configured: true, state: 'ready' },
    });
    for (const entry of [cli, api]) {
      entry.getStatus = async () => {
        readinessChecks += 1;
        return { configured: true, state: 'ready' };
      };
    }
    const registry = {
      list: () => [cli, api],
      get: (id) => [cli, api].find((entry) => entry.id === id),
    };
    const secretStore = {
      status: () => { credentialStatusChecks += 1; return { configured: true }; },
    };
    const preferences = { get: () => ({ mode: 'no_ai', profileId: api.id }) };
    const { createProviderSettingsRouter } = await import('../server/src/routes/providers.js');
    const { server, base } = await listen(createProviderSettingsRouter({ registry, secretStore, preferences, activeProfileId: api.id }));
    try {
      const response = await fetch(base);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.mode, 'no_ai');
      assert.equal(readinessChecks, 0);
      assert.equal(credentialStatusChecks, 0);
      assert.deepEqual(body.profiles.map((entry) => entry.readiness), [
        { configured: false, deferred: true },
        { configured: false, deferred: true },
      ]);
      assert.deepEqual(body.profiles.find((entry) => entry.id === api.id).credential, {
        configured: false,
        deferred: true,
      });
    } finally {
      server.close();
    }
  });

  it('supports no-AI, API-key, expired CLI, switch, and disconnect without secret readback or inference', async () => {
    const api = profile({
      id: 'openai:api', providerId: 'openai', label: 'OpenAI API', authClass: 'api_key',
      status: { profileId: 'openai:api', providerId: 'openai', authClass: 'api_key', configured: false, state: 'unconfigured', reason: 'api_key_missing', summary: 'Not configured.', setup: 'Add an API key.' },
    });
    const cli = profile({
      id: 'anthropic:claude-code', providerId: 'anthropic', label: 'Claude Code', authClass: 'subscription_cli',
      status: { profileId: 'anthropic:claude-code', providerId: 'anthropic', authClass: 'subscription_cli', configured: false, state: 'unconfigured', reason: 'cli_auth_expired', summary: 'Sign-in expired.', setup: 'Run claude auth login.' },
    });
    const configured = new Set();
    const secretStore = {
      status: (profileId) => ({ profileId, configured: configured.has(profileId) }),
      put: (profileId) => { configured.add(profileId); return { profileId, configured: true }; },
      delete: (profileId) => { configured.delete(profileId); return { profileId, configured: false }; },
    };
    let preference = { mode: 'provider', profileId: 'anthropic:claude-code' };
    const preferences = {
      get: () => preference,
      set: (next) => { preference = { ...preference, ...next }; return preference; },
    };
    const registry = {
      list: () => [cli, api],
      get: (id) => {
        const found = [cli, api].find((entry) => entry.id === id);
        if (!found) throw new Error(`unknown provider profile: ${id}`);
        return found;
      },
    };
    const { createProviderSettingsRouter } = await import('../server/src/routes/providers.js');
    const { server, base } = await listen(createProviderSettingsRouter({ registry, secretStore, preferences, activeProfileId: cli.id }));
    try {
      let response = await fetch(base);
      assert.equal(response.status, 200);
      let body = await response.json();
      assert.equal(body.mode, 'provider');
      assert.equal(body.active_profile_id, cli.id);
      assert.match(body.remote_processing_disclosure, /leave(s)? (?:this )?Mac|remote provider/i);
      assert.equal(body.profiles.find((entry) => entry.id === cli.id).readiness.reason, 'cli_auth_expired');
      assert.deepEqual(body.profiles.find((entry) => entry.id === api.id).credential, { configured: false });
      assert.doesNotMatch(JSON.stringify(body), /value|suffix|fingerprint/i);

      const canary = 'API-SECRET-CANARY';
      response = await fetch(`${base}/${encodeURIComponent(api.id)}/credential`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: canary }),
      });
      assert.equal(response.status, 200);
      const saved = await response.json();
      assert.deepEqual(saved, { profile_id: api.id, configured: true });
      assert.doesNotMatch(JSON.stringify(saved), new RegExp(canary));

      response = await fetch(`${base}/selection`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'provider', profile_id: api.id }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { mode: 'provider', profile_id: api.id, restart_required: true });

      response = await fetch(`${base}/selection`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'no_ai' }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { mode: 'no_ai', profile_id: api.id, restart_required: true });

      response = await fetch(`${base}/${encodeURIComponent(cli.id)}/credential`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: canary }),
      });
      assert.equal(response.status, 400, 'CLI profiles must never accept copied credentials');

      response = await fetch(`${base}/${encodeURIComponent(api.id)}/credential`, { method: 'DELETE' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { profile_id: api.id, configured: false });
    } finally {
      server.close();
    }
  });
});
