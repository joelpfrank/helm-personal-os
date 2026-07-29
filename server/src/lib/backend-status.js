// Auth/backend capability layer. One place that answers, honestly, "can the
// coach actually run right now, and if not, what should the user do?"
//
// Two backends exist (see lib/llm.js):
//   - 'sdk' (default): Claude Agent SDK using Claude Code's local
//     subscription auth. Selected ≠ configured — we verify by probing
//     `claude auth status` with a bounded timeout and a short cache, so the
//     CLI is never spawned per-request and no inference call is ever made.
//   - 'api': the Messages API. Configured = ANTHROPIC_API_KEY present. Only
//     presence is checked; the value never leaves the process.
//
// Everything is dependency-injected (probe fn, clock, key check) so tests
// cover every state without subprocesses or network.

import { execFile } from 'node:child_process';
import { hasApiKey as anthropicHasApiKey } from './anthropic.js';

// Every env var that can carry Anthropic credentials — scrubbing only
// ANTHROPIC_API_KEY would still leak an auth token to SDK subprocesses.
export const ANTHROPIC_CREDENTIAL_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

// Copy of `env` with all Anthropic credentials removed. Used when handing an
// environment to the SDK subprocess so it can only use local Claude Code
// auth (and can never see the server's API key).
export function scrubAnthropicEnv(env = process.env) {
  const scrubbed = { ...env };
  for (const key of ANTHROPIC_CREDENTIAL_ENV_KEYS) delete scrubbed[key];
  return scrubbed;
}

export function resolveBackend(env = process.env) {
  return env.LLM_BACKEND === 'api' ? 'api' : 'sdk';
}

// The one CLI invocation we allow: a status check. Never a chat/inference
// command. HELM_CLAUDE_BIN overrides the binary path (LaunchAgents run with
// a minimal PATH — same pattern as WHISPER_CLI in routes/chat.js).
export const SDK_AUTH_PROBE = {
  args: ['auth', 'status'],
  timeoutMs: 3000,
};

function claudeBin() {
  return process.env.HELM_CLAUDE_BIN || 'claude';
}

// Default probe: run `claude auth status` once, normalize every possible
// outcome (missing binary, unauthenticated, expired, timeout, garbage
// output) into { ok, reason }. Failure to positively verify auth is always
// "unconfigured" — never a guess that things will work.
export function defaultSdkAuthProbe() {
  return new Promise((resolve) => {
    execFile(claudeBin(), SDK_AUTH_PROBE.args, {
      timeout: SDK_AUTH_PROBE.timeoutMs,
      env: scrubAnthropicEnv(),
    }, (err, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`;
      if (err && err.code === 'ENOENT') return resolve({ ok: false, reason: 'cli_missing' });
      if (err && (err.killed || err.signal)) return resolve({ ok: false, reason: 'cli_timeout' });
      if (/expired/i.test(output)) return resolve({ ok: false, reason: 'cli_auth_expired' });
      // Current Claude Code emits JSON by default and documents loggedIn as
      // the machine-readable status field. Parse stdout only: stderr may
      // carry harmless diagnostics that would make valid JSON unparsable.
      try {
        const parsed = JSON.parse(String(stdout || '').trim());
        if (parsed?.loggedIn === false) return resolve({ ok: false, reason: 'cli_unauthenticated' });
        if (!err && parsed?.loggedIn === true) return resolve({ ok: true });
      } catch { /* older CLI versions may emit human-readable text */ }
      if (/not logged in|not authenticated|unauthenticated|no credential|please (log ?in|sign in)/i.test(output)) {
        return resolve({ ok: false, reason: 'cli_unauthenticated' });
      }
      if (err) return resolve({ ok: false, reason: 'cli_error' });
      if (/logged in|authenticated|credential/i.test(output)) return resolve({ ok: true });
      // Exit 0 but output we don't recognize: refuse to claim auth works.
      return resolve({ ok: false, reason: 'cli_error' });
    });
  });
}

// reason → user-facing summary + actionable setup instructions. These fixed
// strings are the ONLY text that leaves the server about auth state.
const SIGN_IN = 'On the machine running Helm, run `claude auth login` (Claude subscription), or switch to the API backend by setting LLM_BACKEND=api with an ANTHROPIC_API_KEY.';
export const STATUS_REASONS = {
  cli_missing: {
    summary: 'The Claude Code CLI is not installed on the server.',
    setup: `Install Claude Code so the coach can use your subscription. ${SIGN_IN}`,
  },
  cli_unauthenticated: {
    summary: 'Claude Code is installed but not signed in.',
    setup: SIGN_IN,
  },
  cli_auth_expired: {
    summary: 'The Claude Code sign-in has expired.',
    setup: `Sign in again. ${SIGN_IN}`,
  },
  cli_timeout: {
    summary: 'Checking Claude Code auth timed out.',
    setup: 'Try again in a moment. If it keeps timing out, make sure the `claude` CLI runs on the server (set HELM_CLAUDE_BIN if it lives outside PATH).',
  },
  cli_error: {
    summary: 'Could not verify Claude Code auth.',
    setup: 'Run `claude auth status` on the server to verify the CLI works, then try again.',
  },
  api_key_missing: {
    summary: 'No ANTHROPIC_API_KEY is configured on the server.',
    setup: 'Set ANTHROPIC_API_KEY in the server environment (see README → Coach setup) and restart Helm.',
  },
};

function ready(backend, summary) {
  return { backend, configured: true, state: 'ready', reason: null, summary, setup: null };
}

function unconfigured(backend, reason) {
  const text = STATUS_REASONS[reason] || STATUS_REASONS.cli_error;
  return { backend, configured: false, state: 'unconfigured', reason, summary: text.summary, setup: text.setup };
}

export function createBackendStatus({
  backend = resolveBackend(),
  hasApiKey = anthropicHasApiKey,
  probeSdkAuth = defaultSdkAuthProbe,
  now = Date.now,
  cacheTtlMs = Number(process.env.HELM_AUTH_STATUS_TTL_MS ?? 30_000),
} = {}) {
  let cached = null; // { status, at } — sdk probe results only

  async function probeStatus() {
    let result;
    try {
      result = await probeSdkAuth();
    } catch {
      result = null;
    }
    if (result && result.ok === true) {
      return ready('sdk', 'Claude Code subscription auth verified on this server.');
    }
    const reason = result && STATUS_REASONS[result.reason] ? result.reason : 'cli_error';
    return unconfigured('sdk', reason);
  }

  return {
    backend,
    async getStatus() {
      if (backend === 'api') {
        // Presence check only — the key value is never read into the status.
        return hasApiKey()
          ? ready('api', 'Anthropic API key configured on the server.')
          : unconfigured('api', 'api_key_missing');
      }
      if (cached && now() - cached.at < cacheTtlMs) return cached.status;
      const status = await probeStatus();
      cached = { status, at: now() };
      return status;
    },
    invalidate() { cached = null; },
  };
}
