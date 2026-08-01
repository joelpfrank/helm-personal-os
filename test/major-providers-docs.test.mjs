// Provider documentation drifts silently: a profile can be added to the
// registry and never documented, or documented after being removed, and a
// string-matching test would pass either way. These cases read the real
// registry and the real secret-storage map, so the documentation is checked
// against what the product actually ships.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Importing the registry resolves runtime provider preferences, which creates
// the state directory. Point that at a disposable one before the import so this
// test never touches the default `server/data` path a developer may be using.
process.env.HELM_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-docs-'));
const { providerRegistry } = await import('../server/src/lib/providers/registry.js');
const { PROFILE_ENV_KEYS } = await import('../server/src/lib/provider-secrets.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PROFILE_ID = /\b[a-z][a-z0-9-]*:[a-z][a-z0-9-]*\b/g;

describe('major provider setup and privacy documentation', () => {
  it('documents exactly the profiles the registry ships, with their env keys', () => {
    const readme = read('README.md');
    const shipped = providerRegistry.list().map((profile) => profile.id).sort();

    const undocumented = shipped.filter((id) => !readme.includes(id));
    assert.deepEqual(undocumented, [], 'these shipped provider profiles are absent from the README');

    // The reverse direction catches the worse failure: a profile removed from
    // the product but still advertised to a reader who would then configure it.
    const known = new Set(shipped);
    const advertised = [...new Set(readme.match(PROFILE_ID) ?? [])]
      .filter((candidate) => shipped.some((id) => id.split(':')[0] === candidate.split(':')[0]))
      .filter((candidate) => !known.has(candidate));
    assert.deepEqual(advertised, [], 'the README advertises provider profiles the registry does not ship');

    for (const [id, keys] of Object.entries(PROFILE_ENV_KEYS)) {
      assert.ok(known.has(id), `provider-secrets knows ${id}, which the registry does not ship`);
      assert.ok(keys.some((key) => readme.includes(key)),
        `the README must name an environment key for ${id}`);
    }
    assert.match(readme, /HELM_PROVIDER_PROFILE/);
  });

  it('keeps subscription plans, API billing, and remote processing honestly separated', () => {
    const readme = read('README.md');
    const privacy = read('PRIVACY.md');
    for (const boundary of [
      /OpenAI API billing[^\n]+separate[^\n]+ChatGPT/i,
      /Gemini API[^\n]+separate[^\n]+consumer|consumer[^\n]+not[^\n]+Gemini API/i,
      /OpenRouter[^\n]+credits/i,
      // A CLI Helm cannot drive must never read as supported.
      /Gemini CLI[^\n]+not supported/i,
      /claude auth login/,
      /codex login/,
      // The Codex profile must never read as a substitute for an OpenAI API key.
      /Codex[^.]*plan\W+path; it is not[^.]*OpenAI API key/i,
    ]) {
      assert.match(readme, boundary);
    }
    for (const boundary of [
      /never reads, copies, or reuses its stored credentials as an API key/i,
      /minimum selected Helm context/i,
      /API key[^\n]+outside[^\n]+SQLite|outside[^\n]+SQLite[^\n]+API key/i,
    ]) {
      assert.match(privacy, boundary);
    }
    for (const provider of ['OpenAI', 'Google Gemini', 'OpenRouter']) {
      assert.match(privacy, new RegExp(provider, 'i'));
    }
  });
});
