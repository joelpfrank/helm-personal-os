import { Router } from 'express';
import { providerRegistry, ACTIVE_PROFILE_ID } from '../lib/providers/registry.js';
import { createProviderSecretStore } from '../lib/provider-secrets.js';
import { createProviderPreferences } from '../lib/provider-preferences.js';
import { ApiError } from '../lib/errors.js';

// Must be an ApiError: the shared error handler deliberately refuses to let an
// unrecognized error shape choose its own status, so a plain Error carrying
// `.status` would reach the client as an opaque 500 instead of the reason.
function httpError(status, message, code = 'validation') {
  return new ApiError(code, message, status);
}

function defaultSecretStore() {
  const load = () => createProviderSecretStore();
  return {
    status(profileId) {
      try { return load().status(profileId); }
      catch (error) {
        if (/HELM_STATE_DIR is required/.test(error.message)) return { profileId, configured: false };
        throw error;
      }
    },
    put: (profileId, value) => load().put(profileId, value),
    delete: (profileId) => load().delete(profileId),
  };
}

function defaultPreferences(registry, activeProfileId) {
  const load = () => createProviderPreferences({ knownProfileIds: registry.list().map((profile) => profile.id) });
  return {
    get() {
      try {
        const saved = load().get();
        return saved.mode === 'no_ai' || saved.profileId
          ? saved
          : { mode: 'provider', profileId: activeProfileId };
      } catch (error) {
        if (/HELM_STATE_DIR is required/.test(error.message)) return { mode: 'provider', profileId: activeProfileId };
        throw error;
      }
    },
    set: (value) => load().set(value),
  };
}

function publicModel(model) {
  return {
    id: model.id,
    label: model.label,
    tier: model.tier,
    hint: model.hint,
    capabilities: model.capabilities,
  };
}

export function createProviderSettingsRouter({
  registry = providerRegistry,
  activeProfileId = ACTIVE_PROFILE_ID,
  secretStore = defaultSecretStore(),
  preferences = defaultPreferences(registry, activeProfileId),
} = {}) {
  const router = Router();

  function findProfile(profileId) {
    try { return registry.get(profileId); }
    catch { throw httpError(404, 'unknown provider profile', 'not_found'); }
  }

  router.get('/', async (_req, res, next) => {
    try {
      const selection = preferences.get();
      const profiles = await Promise.all(registry.list().map(async (profile) => {
        const readiness = selection.mode === 'no_ai'
          ? { configured: false, deferred: true }
          : await profile.getStatus();
        const credential = profile.authClass === 'api_key'
          ? (selection.mode === 'no_ai'
            ? { configured: false, deferred: true }
            : { configured: secretStore.status(profile.id).configured || readiness.configured === true })
          : null;
        return {
          id: profile.id,
          provider_id: profile.providerId,
          label: profile.label,
          authentication_class: profile.authClass,
          capabilities: profile.capabilities,
          models: profile.models.map(publicModel),
          default_model: profile.defaultModel,
          active: profile.id === activeProfileId,
          selected: profile.id === selection.profileId,
          credential,
          readiness,
        };
      }));
      res.json({
        mode: selection.mode,
        selected_profile_id: selection.profileId,
        active_profile_id: activeProfileId,
        restart_required: selection.mode !== 'provider' || selection.profileId !== activeProfileId,
        remote_processing_disclosure: 'When AI is enabled, selected prompts, attachments, and Coach context leave this Mac for the chosen remote provider. Core Helm records work without AI.',
        profiles,
      });
    } catch (error) { next(error); }
  });

  router.put('/selection', (req, res, next) => {
    try {
      const body = req.body || {};
      const keys = Object.keys(body);
      if (keys.some((key) => !['mode', 'profile_id'].includes(key))) throw httpError(400, 'unknown selection field');
      if (!['provider', 'no_ai'].includes(body.mode)) throw httpError(400, 'mode must be provider or no_ai');
      if (body.mode === 'provider') findProfile(body.profile_id);
      const saved = preferences.set(body.mode === 'provider'
        ? { mode: body.mode, profileId: body.profile_id }
        : { mode: body.mode });
      res.json({ mode: saved.mode, profile_id: saved.profileId, restart_required: true });
    } catch (error) { next(error); }
  });

  router.put('/:profileId/credential', (req, res, next) => {
    try {
      const profile = findProfile(req.params.profileId);
      if (profile.authClass !== 'api_key') {
        throw httpError(400, 'Subscription and CLI profiles use the provider-owned sign-in flow; Helm never accepts copied CLI credentials.');
      }
      const keys = Object.keys(req.body || {});
      if (keys.length !== 1 || keys[0] !== 'credential') throw httpError(400, 'credential is required');
      const result = secretStore.put(profile.id, req.body.credential);
      res.json({ profile_id: result.profileId, configured: result.configured });
    } catch (error) { next(error); }
  });

  router.delete('/:profileId/credential', (req, res, next) => {
    try {
      const profile = findProfile(req.params.profileId);
      if (profile.authClass !== 'api_key') throw httpError(400, 'CLI sign-in must be disconnected through the provider-owned CLI.');
      const result = secretStore.delete(profile.id);
      res.json({ profile_id: result.profileId, configured: result.configured });
    } catch (error) { next(error); }
  });

  return router;
}

export default createProviderSettingsRouter();
