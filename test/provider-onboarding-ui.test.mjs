import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { maintainerOnly } from '../scripts/lib/tree-context.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('Provider onboarding Configure surface', () => {
  it('offers no-AI, API-key, CLI readiness, compatible models, disclosure, switching, and disconnect', () => {
    const source = read('web/src/views/ProviderSettingsView.jsx');
    for (const copy of [
      /Use Helm without AI/i,
      /API key/i,
      /subscription|CLI/i,
      /models available/i,
      /leave(s)? (?:this )?Mac|remote provider/i,
      /disconnect|delete credential/i,
      /restart Helm/i,
    ]) assert.match(source, copy);
    assert.match(source, /type="password"/);
    assert.match(source, /autoComplete="off"/);
    assert.doesNotMatch(source, /credential.*localStorage|localStorage.*credential/is);
    assert.match(source, /profile\.models\.map/);
  });

  it('allows an explicit provider-enabling transition while no-AI defers readiness checks', () => {
    const source = read('web/src/views/ProviderSettingsView.jsx');
    assert.match(source, /profile\.readiness\?\.deferred/);
    assert.match(source, /Enable this provider and restart Helm to check readiness/i);
  });

  it('exposes settings from the shell and Coach setup banner without changing primary navigation', () => {
    const app = read('web/src/App.jsx');
    const shell = read('web/src/components/shell/AppShell.jsx');
    const chat = read('web/src/views/ChatView.jsx');
    assert.match(app, /ProviderSettingsView/);
    assert.match(app, /helm:open-ai-settings/);
    assert.match(shell, /AI settings/);
    assert.match(chat, /Open AI settings/);
    const ids = [...app.matchAll(/id:\s*'(tasks|food|habits|workouts|coach)'/g)].map((match) => match[1]);
    assert.deepEqual(ids, ['tasks', 'food', 'habits', 'workouts', 'coach']);
  });

  it('uses a dedicated provider store with write-only credential requests and immediate secret clearing', () => {
    const store = read('web/src/state/providers.js');
    assert.match(store, /apiGet\('\/providers'\)/);
    assert.match(store, /apiPut\(`\/providers\/\$\{encodeURIComponent\(profileId\)\}\/credential`/);
    assert.match(store, /apiDelete\(`\/providers\/\$\{encodeURIComponent\(profileId\)\}\/credential`/);
    assert.doesNotMatch(store, /credential\s*:/, 'provider store must not retain credential bytes in state');
    const view = read('web/src/views/ProviderSettingsView.jsx');
    assert.match(view, /setCredential\(''\)/);
  });

  it('provides responsive, focus-visible, and reduced-motion settings styles', () => {
    const css = read('web/src/styles/provider-settings.css');
    assert.match(css, /@media\s*\(max-width:\s*720px\)/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(css, /min-height:\s*44px/);
  });

  it('keeps browser verification output disposable instead of rewriting frozen evidence', {
    skip: maintainerOnly('the browser-verifier evidence check'),
  }, () => {
    const verifier = read('.hermes/evidence/m7-provider-onboarding/verify-provider-onboarding.mjs');
    assert.match(verifier, /mkdtempSync\([^\n]+helm-m7-verifier-output-/);
    assert.match(verifier, /path\.join\(OUTPUT, 'provider-settings-1440x900\.png'\)/);
    assert.match(verifier, /path\.join\(OUTPUT, 'provider-settings-390x844\.png'\)/);
    assert.match(verifier, /path\.join\(OUTPUT, 'browser-verification\.json'\)/);
    assert.doesNotMatch(verifier, /path\.join\(OUT, 'provider-settings-|path\.join\(OUT, 'browser-verification/);
  });
});
