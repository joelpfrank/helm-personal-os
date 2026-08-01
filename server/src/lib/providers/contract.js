const PROFILE_ID = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const STATUS_KEYS = new Set(['configured', 'state', 'reason']);
const STATUS_STATES = new Set(['ready', 'unconfigured', 'error']);
const SIGN_IN = 'On the machine running Helm, run `claude auth login` (Claude subscription), or switch to the API backend by setting LLM_BACKEND=api with an ANTHROPIC_API_KEY.';
const STATUS_PRESENTATION = Object.freeze({
  cli_missing: Object.freeze({ summary: 'The Claude Code CLI is not installed on the server.', setup: `Install Claude Code so the coach can use your subscription. ${SIGN_IN}` }),
  cli_unauthenticated: Object.freeze({ summary: 'Claude Code is installed but not signed in.', setup: SIGN_IN }),
  cli_auth_expired: Object.freeze({ summary: 'The Claude Code sign-in has expired.', setup: `Sign in again. ${SIGN_IN}` }),
  cli_timeout: Object.freeze({ summary: 'Checking Claude Code auth timed out.', setup: 'Try again in a moment. If it keeps timing out, make sure the `claude` CLI runs on the server (set HELM_CLAUDE_BIN if it lives outside PATH).' }),
  cli_error: Object.freeze({ summary: 'Could not verify Claude Code auth.', setup: 'Run `claude auth status` on the server to verify the CLI works, then try again.' }),
  api_key_missing: Object.freeze({ summary: 'No ANTHROPIC_API_KEY is configured on the server.', setup: 'Set ANTHROPIC_API_KEY in the server environment (see README → Coach setup) and restart Helm.' }),
});

export const AUTH_CLASSES = Object.freeze(['api_key', 'subscription_cli']);
export const CAPABILITY_KEYS = Object.freeze([
  'text', 'vision', 'documents', 'tools', 'web', 'subscriptionLogin',
]);

export function backendKindForProfile(profile) {
  if (!profile || !AUTH_CLASSES.includes(profile.authClass)) throw new Error('provider profile is required');
  return profile.authClass === 'api_key' ? 'api' : 'sdk';
}

function normalizeCapabilities(value = {}) {
  return Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, value[key] === true])));
}

function normalizeModels(models) {
  if (!Array.isArray(models) || models.length === 0) throw new Error('provider profile models must be non-empty');
  const ids = new Set();
  return Object.freeze(models.map((model) => {
    if (!model || typeof model.id !== 'string' || !model.id.trim() || ids.has(model.id)) {
      throw new Error('provider model ids must be unique non-empty strings');
    }
    ids.add(model.id);
    return Object.freeze({
      id: model.id,
      label: String(model.label || model.id),
      tier: model.tier || null,
      hint: model.hint || null,
      capabilities: normalizeCapabilities(model.capabilities),
    });
  }));
}

function normalizeStatus(profile, raw, presentationOverrides, readySummary) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('provider status must be an object');
  const unknown = Object.keys(raw).filter((key) => !STATUS_KEYS.has(key));
  if (unknown.length) throw new Error(`provider status keys are not allowed: ${unknown.join(', ')}`);
  if (typeof raw.configured !== 'boolean' || !STATUS_STATES.has(raw.state)) {
    throw new Error('provider status configured/state are invalid');
  }
  if (raw.reason != null && !Object.hasOwn(STATUS_PRESENTATION, raw.reason)) {
    throw new Error('provider status reason is invalid');
  }
  if (raw.state === 'ready' && (!raw.configured || raw.reason != null)) {
    throw new Error('ready provider status is inconsistent');
  }
  if (raw.state !== 'ready' && (raw.configured || raw.reason == null)) {
    throw new Error('provider status is inconsistent');
  }
  const presentation = raw.reason == null ? {
    summary: readySummary || (profile.authClass === 'subscription_cli'
      ? 'Subscription CLI authentication verified on this server.'
      : 'API key configured on the server.'),
    setup: null,
  } : (presentationOverrides[raw.reason] || STATUS_PRESENTATION[raw.reason]);
  return Object.freeze({
    profileId: profile.id,
    providerId: profile.providerId,
    authClass: profile.authClass,
    configured: raw.configured,
    state: raw.state,
    reason: raw.reason || null,
    summary: presentation.summary,
    setup: presentation.setup,
  });
}

export function createProviderProfile(input) {
  if (!input || typeof input !== 'object') throw new Error('provider profile is required');
  if (!PROFILE_ID.test(input.id || '')) throw new Error('provider profile id must use provider:profile syntax');
  if (typeof input.providerId !== 'string' || !input.providerId) throw new Error('provider id is required');
  if (!AUTH_CLASSES.includes(input.authClass)) throw new Error('provider authentication class is invalid');
  if (typeof input.status !== 'function' || typeof input.stream !== 'function') {
    throw new Error('provider profile requires status and stream functions');
  }
  const models = normalizeModels(input.models);
  if (!models.some((model) => model.id === input.defaultModel)) {
    throw new Error('provider default model must exist in its own catalog');
  }
  const presentationOverrides = Object.freeze(Object.fromEntries(Object.entries(input.statusPresentation || {}).map(([reason, value]) => {
    if (!Object.hasOwn(STATUS_PRESENTATION, reason)
        || !value || typeof value.summary !== 'string'
        || (value.setup != null && typeof value.setup !== 'string')) {
      throw new Error('provider status presentation is invalid');
    }
    return [reason, Object.freeze({ summary: value.summary, setup: value.setup ?? null })];
  })));
  if (input.readySummary != null && typeof input.readySummary !== 'string') {
    throw new Error('provider ready summary is invalid');
  }
  const profile = {
    id: input.id,
    providerId: input.providerId,
    label: String(input.label || input.id),
    authClass: input.authClass,
    capabilities: normalizeCapabilities(input.capabilities),
    models,
    defaultModel: input.defaultModel,
    toolExecution: input.toolExecution === 'provider' ? 'provider' : 'client',
    async getStatus() { return normalizeStatus(profile, await input.status(), presentationOverrides, input.readySummary); },
    stream(request) { return input.stream(request); },
  };
  return Object.freeze(profile);
}
