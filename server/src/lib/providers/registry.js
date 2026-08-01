import { ANTHROPIC_API_PROFILE } from './anthropic-api.js';
import { CLAUDE_CODE_PROFILE } from './claude-code.js';
import { CODEX_CLI_PROFILE } from './codex-cli.js';
import { OPENAI_API_PROFILE } from './openai-api.js';
import { GEMINI_API_PROFILE } from './gemini-api.js';
import { OPENROUTER_API_PROFILE } from './openrouter-api.js';
import { createProviderPreferences } from '../provider-preferences.js';
import { ApiError } from '../errors.js';

export function resolveProviderSelection(env = process.env, preferences = null) {
  const explicit = typeof env.HELM_PROVIDER_PROFILE === 'string' ? env.HELM_PROVIDER_PROFILE.trim() : '';
  if (explicit) return { mode: 'provider', profileId: explicit };
  if (preferences) {
    const saved = preferences.get();
    if (saved?.profileId) return { mode: saved.mode, profileId: saved.profileId };
  }
  return {
    mode: 'provider',
    profileId: env.LLM_BACKEND === 'api' ? 'anthropic:api' : 'anthropic:claude-code',
  };
}

export function resolveActiveProfileId(env = process.env) {
  return resolveProviderSelection(env).profileId;
}

export function createProviderRegistry(profiles = []) {
  const byId = new Map();
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== 'string') throw new Error('provider registry entries must be profiles');
    if (byId.has(profile.id)) throw new Error(`duplicate provider profile: ${profile.id}`);
    byId.set(profile.id, profile);
  }
  return Object.freeze({
    list: () => [...byId.values()],
    get(profileId) {
      const profile = byId.get(profileId);
      if (!profile) throw new Error(`unknown provider profile: ${profileId}`);
      return profile;
    },
    resolveModel(profileId, requested) {
      const profile = this.get(profileId);
      if (!requested) return { model: profile.defaultModel, fallback: false };
      if (profile.models.some((model) => model.id === requested)) return { model: requested, fallback: false };
      return { model: profile.defaultModel, fallback: true, requested };
    },
  });
}

export const providerRegistry = createProviderRegistry([
  CLAUDE_CODE_PROFILE,
  CODEX_CLI_PROFILE,
  ANTHROPIC_API_PROFILE,
  OPENAI_API_PROFILE,
  GEMINI_API_PROFILE,
  OPENROUTER_API_PROFILE,
]);

let runtimePreferences = null;
try {
  runtimePreferences = createProviderPreferences({
    knownProfileIds: providerRegistry.list().map((profile) => profile.id),
  });
} catch (error) {
  if (!/HELM_STATE_DIR is required/.test(error.message)) throw error;
}
export const ACTIVE_SELECTION = Object.freeze(resolveProviderSelection(process.env, runtimePreferences));
export const ACTIVE_PROFILE_ID = ACTIVE_SELECTION.profileId;
export const ACTIVE_AI_MODE = ACTIVE_SELECTION.mode;

export function assertAiEnabled(mode = ACTIVE_AI_MODE) {
  if (mode === 'no_ai') {
    throw new ApiError(
      'ai_disabled',
      'Helm is running without AI. Enable a provider in AI settings before using AI features.',
      409,
    );
  }
}
