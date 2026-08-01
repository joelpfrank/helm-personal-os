// Validation and normalization for the structured coaching profile.

const PROFILE_KEYS = new Set([
  'motivational_drivers',
  'resistance_patterns',
  'avoidance_signals',
  'communication_style',
  'challenge_level',
  'breakthrough_moments',
  'approaches_that_backfire',
]);

const STRING_ARRAY_KEYS = new Set([
  'motivational_drivers',
  'resistance_patterns',
  'avoidance_signals',
  'approaches_that_backfire',
]);

const MAX_PROFILE_BYTES = 8000;

export function validateCoachingProfile(profile) {
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
    throw new Error('coaching_profile must be a plain object');
  }

  for (const k of Object.keys(profile)) {
    if (!PROFILE_KEYS.has(k)) throw new Error(`unknown profile field: ${k}`);
  }

  for (const k of STRING_ARRAY_KEYS) {
    if (!(k in profile)) continue;
    if (!Array.isArray(profile[k])) throw new Error(`${k} must be an array`);
    for (const item of profile[k]) {
      if (typeof item !== 'string') throw new Error(`${k} entries must be strings`);
    }
  }

  if ('communication_style' in profile) {
    if (typeof profile.communication_style !== 'string') {
      throw new Error('communication_style must be a string');
    }
  }

  if ('challenge_level' in profile) {
    const cl = profile.challenge_level;
    if (!Number.isInteger(cl) || cl < 1 || cl > 5) {
      throw new Error('challenge_level must be an integer 1-5');
    }
  }

  if ('breakthrough_moments' in profile) {
    if (!Array.isArray(profile.breakthrough_moments)) {
      throw new Error('breakthrough_moments must be an array');
    }
    const BREAKTHROUGH_KEYS = new Set(['date', 'description']);
    for (const item of profile.breakthrough_moments) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('breakthrough_moments entries must be objects');
      }
      for (const k of Object.keys(item)) {
        if (!BREAKTHROUGH_KEYS.has(k)) throw new Error(`unknown breakthrough_moments subkey: ${k}`);
      }
      if (typeof item.date !== 'string') throw new Error('breakthrough_moments entries need a date string');
      if (typeof item.description !== 'string') throw new Error('breakthrough_moments entries need a description string');
    }
  }

  const json = JSON.stringify(profile);
  if (json.length > MAX_PROFILE_BYTES) {
    throw new Error(`coaching_profile exceeds ${MAX_PROFILE_BYTES} byte size limit`);
  }

  return profile;
}

// Merge updates into an existing profile. null values remove the key.
export function mergeProfile(existing, updates) {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }
  return merged;
}
