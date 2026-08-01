// TDD tests: backend-aware model catalog + deterministic compatibility
// fallback. RED first — server/src/lib/coach-models.js must FAIL these
// before being written.
//
// Contract: the picker only ever advertises real, public model ids; every
// entry declares which backends can serve it; and a stored model that the
// selected backend cannot serve resolves to a documented deterministic
// fallback (the default model) — never a silent pass-through failure.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  MODELS,
  DEFAULT_MODEL_ID,
  modelsForBackend,
  resolveModelForBackend,
} = await import('../server/src/lib/coach-models.js');

// The public Anthropic model ids Helm is allowed to advertise.
const PUBLIC_IDS = new Set([
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]);

describe('model catalog', () => {
  it('advertises only real, public model ids', () => {
    assert.ok(MODELS.length > 0);
    for (const m of MODELS) {
      assert.ok(PUBLIC_IDS.has(m.id), `${m.id} is not an approved public model id`);
      assert.doesNotMatch(m.id, /mythos|preview|internal/i, 'no speculative/non-public ids');
    }
  });

  it('every model declares a non-empty set of compatible backends', () => {
    for (const m of MODELS) {
      assert.ok(Array.isArray(m.backends) && m.backends.length > 0, `${m.id} must declare backends`);
      for (const b of m.backends) assert.ok(['sdk', 'api'].includes(b), `${m.id}: unknown backend ${b}`);
    }
  });

  it('the default model exists in the catalog and works on both backends', () => {
    const def = MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
    assert.ok(def, 'DEFAULT_MODEL_ID must be a catalog entry');
    assert.deepEqual([...def.backends].sort(), ['api', 'sdk']);
  });

  it('modelsForBackend returns only entries the backend can serve', () => {
    const fixtures = [
      { id: 'claude-sonnet-5', backends: ['sdk', 'api'] },
      { id: 'claude-haiku-4-5-20251001', backends: ['api'] },
    ];
    assert.deepEqual(modelsForBackend('sdk', fixtures).map((m) => m.id), ['claude-sonnet-5']);
    assert.deepEqual(modelsForBackend('api', fixtures).map((m) => m.id),
      ['claude-sonnet-5', 'claude-haiku-4-5-20251001']);
  });
});

describe('resolveModelForBackend', () => {
  it('keeps a compatible stored model unchanged', () => {
    const r = resolveModelForBackend('claude-haiku-4-5-20251001', 'sdk');
    assert.deepEqual(r, { model: 'claude-haiku-4-5-20251001', fallback: false });
  });

  it('no stored model resolves to the same explicit default advertised by status', () => {
    assert.deepEqual(resolveModelForBackend(null, 'sdk'), { model: DEFAULT_MODEL_ID, fallback: false });
    assert.deepEqual(resolveModelForBackend(undefined, 'api'), { model: DEFAULT_MODEL_ID, fallback: false });
  });

  it('a stale/unknown stored id falls back deterministically to the default model', () => {
    const r = resolveModelForBackend('claude-3-5-sonnet-legacy', 'api');
    assert.deepEqual(r, {
      model: DEFAULT_MODEL_ID,
      fallback: true,
      requested: 'claude-3-5-sonnet-legacy',
    });
  });

  it('a backend-incompatible id falls back deterministically to the default model', () => {
    const fixtures = [
      { id: 'api-only-model', backends: ['api'] },
      { id: DEFAULT_MODEL_ID, backends: ['sdk', 'api'] },
    ];
    const r = resolveModelForBackend('api-only-model', 'sdk', fixtures);
    assert.deepEqual(r, { model: DEFAULT_MODEL_ID, fallback: true, requested: 'api-only-model' });
    // …and stays put on a backend that can serve it.
    assert.deepEqual(resolveModelForBackend('api-only-model', 'api', fixtures),
      { model: 'api-only-model', fallback: false });
  });
});
