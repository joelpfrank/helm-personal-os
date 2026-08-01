// The coach's model catalog — the only model ids Helm ever advertises.
// All entries are real, public Anthropic model ids (no previews, no
// speculative ids). Order = recommended display order in the picker.
//
// `backends` declares which chat backends (lib/llm.js: 'sdk' subscription /
// 'api' Messages API) can serve the model. Both currently serve the full
// Anthropic lineup, but the field is load-bearing: resolveModelForBackend()
// uses it so a stored model the active backend cannot serve gets a
// deterministic, documented fallback instead of a silent provider failure.

export const MODELS = [
  { id: 'claude-fable-5',            label: 'Fable 5',    tier: 'premium',  backends: ['sdk', 'api'], hint: 'most capable — long-horizon, hardest problems (pricier, slower)' },
  { id: 'claude-opus-4-8',           label: 'Opus 4.8',   tier: 'premium',  backends: ['sdk', 'api'], hint: 'complex agentic & enterprise work' },
  { id: 'claude-sonnet-5',           label: 'Sonnet 5',   tier: 'balanced', backends: ['sdk', 'api'], hint: 'best balance of speed & intelligence — great default' },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', tier: 'balanced', backends: ['sdk', 'api'], hint: 'previous Sonnet' },
  { id: 'claude-opus-4-7',           label: 'Opus 4.7',   tier: 'premium',  backends: ['sdk', 'api'], hint: 'previous Opus flagship' },
  { id: 'claude-opus-4-6',           label: 'Opus 4.6',   tier: 'premium',  backends: ['sdk', 'api'], hint: 'older Opus' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  tier: 'cheap',    backends: ['sdk', 'api'], hint: 'fastest, cheapest — quick logging' },
];

// Documented deterministic fallback target: available on every backend.
export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

export function modelsForBackend(backend, models = MODELS) {
  return models.filter((m) => m.backends.includes(backend));
}

// Resolve a stored/default model against the active backend.
//   - nothing stored          → { model: DEFAULT_MODEL_ID, fallback: false }
//   - compatible stored model → { model: <same>, fallback: false }
//   - unknown or incompatible → { model: DEFAULT_MODEL_ID, fallback: true, requested }
// The fallback is deterministic and logged by the caller — never silent.
export function resolveModelForBackend(modelId, backend, models = MODELS) {
  if (!modelId) return { model: DEFAULT_MODEL_ID, fallback: false };
  const entry = models.find((m) => m.id === modelId);
  if (entry && entry.backends.includes(backend)) return { model: modelId, fallback: false };
  return { model: DEFAULT_MODEL_ID, fallback: true, requested: modelId };
}

// Provider-neutral equivalents. The backend helpers above remain as the
// compatibility surface while profiles become the source of truth.
export function modelsForProfile(profile) {
  return profile.models;
}

export function resolveModelForProfile(modelId, profile) {
  if (!modelId) return { model: profile.defaultModel, fallback: false };
  if (profile.models.some((model) => model.id === modelId)) {
    return { model: modelId, fallback: false };
  }
  return { model: profile.defaultModel, fallback: true, requested: modelId };
}
