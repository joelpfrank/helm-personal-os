// TDD tests: the auth/backend capability layer and the safe provider-error
// taxonomy. RED first — server/src/lib/backend-status.js and
// server/src/lib/provider-errors.js must FAIL these before being written.
//
// Everything here is exercised through dependency injection (probe fns,
// clocks) — no subprocess is spawned, no network request is made, and no
// paid provider call can occur.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  ANTHROPIC_CREDENTIAL_ENV_KEYS,
  scrubAnthropicEnv,
  resolveBackend,
  SDK_AUTH_PROBE,
  createBackendStatus,
} = await import('../server/src/lib/backend-status.js');

const {
  PROVIDER_ERROR_CODES,
  classifyProviderError,
  describeForLog,
} = await import('../server/src/lib/provider-errors.js');

// Secret-shaped canaries, constructed (not literal) so repo secret scanners
// never see a key-shaped string in this file.
const CANARY_KEY = 'sk-ant-api03-' + 'CANARY'.repeat(5);
const CANARY_WORD = 'XYZZY-CANARY-VALUE';

describe('scrubAnthropicEnv', () => {
  it('removes every Anthropic credential variable, not just ANTHROPIC_API_KEY', () => {
    assert.ok(ANTHROPIC_CREDENTIAL_ENV_KEYS.includes('ANTHROPIC_API_KEY'));
    assert.ok(ANTHROPIC_CREDENTIAL_ENV_KEYS.includes('ANTHROPIC_AUTH_TOKEN'));
    const env = {
      ANTHROPIC_API_KEY: CANARY_KEY,
      ANTHROPIC_AUTH_TOKEN: CANARY_WORD,
      PATH: '/usr/bin',
      HOME: '/tmp/home',
    };
    const scrubbed = scrubAnthropicEnv(env);
    for (const key of ANTHROPIC_CREDENTIAL_ENV_KEYS) {
      assert.ok(!(key in scrubbed), `${key} must be scrubbed`);
    }
    assert.equal(scrubbed.PATH, '/usr/bin');
    assert.equal(scrubbed.HOME, '/tmp/home');
  });

  it('does not mutate the input env', () => {
    const env = { ANTHROPIC_API_KEY: CANARY_KEY, KEEP: '1' };
    scrubAnthropicEnv(env);
    assert.equal(env.ANTHROPIC_API_KEY, CANARY_KEY);
  });
});

describe('resolveBackend', () => {
  it('defaults to sdk and honours LLM_BACKEND=api', () => {
    assert.equal(resolveBackend({}), 'sdk');
    assert.equal(resolveBackend({ LLM_BACKEND: 'api' }), 'api');
    assert.equal(resolveBackend({ LLM_BACKEND: 'nonsense' }), 'sdk');
  });
});

describe('createBackendStatus — api backend', () => {
  it('is ready when an API key is present, without ever probing the CLI', async () => {
    let probed = 0;
    const provider = createBackendStatus({
      backend: 'api',
      hasApiKey: () => true,
      probeSdkAuth: async () => { probed += 1; return { ok: true }; },
    });
    const status = await provider.getStatus();
    assert.equal(status.backend, 'api');
    assert.equal(status.configured, true);
    assert.equal(status.state, 'ready');
    assert.equal(status.reason, null);
    assert.equal(probed, 0, 'api backend must never spawn the CLI probe');
  });

  it('reports api_key_missing with actionable setup instructions', async () => {
    const provider = createBackendStatus({ backend: 'api', hasApiKey: () => false });
    const status = await provider.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.state, 'unconfigured');
    assert.equal(status.reason, 'api_key_missing');
    assert.match(status.setup, /ANTHROPIC_API_KEY/, 'setup must name the missing variable');
  });

  it('checks key presence only — the key value never appears in the status', async () => {
    const provider = createBackendStatus({ backend: 'api', hasApiKey: () => true });
    const status = await provider.getStatus();
    assert.doesNotMatch(JSON.stringify(status), /sk-ant/);
  });
});

describe('createBackendStatus — sdk backend', () => {
  const cases = [
    ['cli_missing', /install|not (found|installed)/i],
    ['cli_unauthenticated', /sign in|log ?in/i],
    ['cli_auth_expired', /sign in|log ?in|expired/i],
    ['cli_timeout', /timed? ?out|try again/i],
    ['cli_error', /verify|try again/i],
  ];
  for (const [reason, setupPattern] of cases) {
    it(`maps a ${reason} probe to unconfigured with actionable guidance`, async () => {
      const provider = createBackendStatus({
        backend: 'sdk',
        probeSdkAuth: async () => ({ ok: false, reason }),
      });
      const status = await provider.getStatus();
      assert.equal(status.backend, 'sdk');
      assert.equal(status.configured, false);
      assert.equal(status.state, 'unconfigured');
      assert.equal(status.reason, reason);
      assert.match(status.summary, /\S/, 'summary must be non-empty');
      assert.match(status.setup, setupPattern, `setup for ${reason} must be actionable`);
    });
  }

  it('is ready only when the probe actually verified local auth', async () => {
    const provider = createBackendStatus({
      backend: 'sdk',
      probeSdkAuth: async () => ({ ok: true }),
    });
    const status = await provider.getStatus();
    assert.equal(status.configured, true);
    assert.equal(status.state, 'ready');
    assert.match(status.summary, /sign|auth/i, 'ready summary reflects verified auth, not mere selection');
  });

  it('treats a malformed probe result as cli_error, not as configured', async () => {
    const provider = createBackendStatus({
      backend: 'sdk',
      probeSdkAuth: async () => undefined,
    });
    const status = await provider.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.reason, 'cli_error');
  });

  it('treats a throwing probe as cli_error', async () => {
    const provider = createBackendStatus({
      backend: 'sdk',
      probeSdkAuth: async () => { throw new Error('boom ' + CANARY_WORD); },
    });
    const status = await provider.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.reason, 'cli_error');
    assert.doesNotMatch(JSON.stringify(status), new RegExp(CANARY_WORD));
  });

  it('caches the probe result for the TTL and re-probes after it', async () => {
    let calls = 0;
    let clock = 0;
    const provider = createBackendStatus({
      backend: 'sdk',
      probeSdkAuth: async () => { calls += 1; return { ok: true }; },
      now: () => clock,
      cacheTtlMs: 30_000,
    });
    await provider.getStatus();
    clock = 10_000;
    await provider.getStatus();
    assert.equal(calls, 1, 'a status check within the TTL must not re-probe');
    clock = 40_001;
    await provider.getStatus();
    assert.equal(calls, 2, 'a status check after the TTL must re-probe');
  });

  it('uses a status probe command, never an inference call', () => {
    assert.deepEqual(SDK_AUTH_PROBE.args, ['auth', 'status']);
    assert.ok(SDK_AUTH_PROBE.timeoutMs >= 5_000 && SDK_AUTH_PROBE.timeoutMs <= 10_000,
      'probe must tolerate loaded CI while remaining bounded');
  });
});

describe('classifyProviderError — finite safe taxonomy', () => {
  const fixedMessages = new Set();

  function classify(err) {
    const result = classifyProviderError(err);
    assert.ok(PROVIDER_ERROR_CODES.includes(result.code), `unknown code ${result.code}`);
    assert.match(result.message, /\S/);
    fixedMessages.add(result.message);
    return result;
  }

  it('classifies invalid/expired auth distinctly', () => {
    assert.equal(classify({ status: 401, message: 'invalid x-api-key ' + CANARY_KEY }).code, 'auth');
    assert.equal(classify({ status: 403, message: 'permission denied' }).code, 'auth');
    assert.equal(classify({ body: { error: { type: 'authentication_error', message: CANARY_WORD } } }).code, 'auth');
    assert.equal(classify(new Error('OAuth token has expired. Please run /login')).code, 'auth');
  });

  it('classifies missing setup distinctly', () => {
    assert.equal(classify(new Error('ANTHROPIC_API_KEY not configured')).code, 'setup');
  });

  it('classifies unsupported/unavailable model distinctly', () => {
    assert.equal(classify({ status: 404, body: { error: { type: 'not_found_error', message: 'model: claude-nope' } } }).code, 'model');
    assert.equal(classify(new Error('model claude-nope not found')).code, 'model');
  });

  it('classifies rate limiting distinctly', () => {
    assert.equal(classify({ status: 429, message: 'rate limited' }).code, 'rate_limit');
    assert.equal(classify({ status: 529, body: { error: { type: 'overloaded_error' } } }).code, 'rate_limit');
  });

  it('maps everything else to a generic provider failure', () => {
    assert.equal(classify(new Error('ECONNRESET ' + CANARY_WORD)).code, 'provider');
    assert.equal(classify(undefined).code, 'provider');
  });

  it('public messages come from a fixed map and never echo raw provider text', () => {
    const raws = [
      new Error('raw internals: ' + CANARY_WORD + ' ' + CANARY_KEY),
      { status: 401, message: CANARY_KEY },
      { status: 429, message: CANARY_WORD },
    ];
    for (const raw of raws) {
      const { message } = classify(raw);
      assert.doesNotMatch(message, new RegExp(CANARY_WORD));
      assert.doesNotMatch(message, /sk-ant/);
    }
    assert.ok(fixedMessages.size <= PROVIDER_ERROR_CODES.length,
      'at most one public message per taxonomy code');
  });
});

describe('describeForLog — finite, safe log summary', () => {
  // Arbitrary secrets can't be reliably shape-detected, so the log summary
  // must never include ANY provider/user-derived text (message, body, or
  // stack) — only the closed taxonomy code and a numeric HTTP status.
  it('never includes raw message, body, or stack text — only code and status', () => {
    const err = { status: 401, message: `upstream said: ${CANARY_KEY} (${CANARY_WORD})`,
      body: { error: { type: 'authentication_error', message: CANARY_WORD } } };
    const line = describeForLog(err);
    assert.doesNotMatch(line, /sk-ant-api03/);
    assert.doesNotMatch(line, new RegExp(CANARY_WORD));
    assert.doesNotMatch(line, /upstream said/);
    assert.match(line, /^code=auth status=401$/);
  });

  it('omits status when the error carries none, and still names the code', () => {
    const line = describeForLog(new Error(CANARY_WORD));
    assert.equal(line, 'code=provider');
  });

  it('is bounded and stable regardless of raw error size', () => {
    const line = describeForLog(new Error('x'.repeat(5000)));
    assert.ok(line.length <= 32);
  });
});
