// TDD tests: the web Coach chat surfaces structured backend status instead
// of the old hard-coded "no API key" banner, and the SDK subprocess env is
// scrubbed through the shared helper. RED first.
//
// Source-contract tests (same style as simplified-nav.test.mjs): the web
// build has no DOM test harness, so the contract is asserted on the source
// the build compiles.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('ChatView — structured status banner', () => {
  const source = read('web/src/views/ChatView.jsx');

  it('no longer hard-codes an API-key-only unavailable message', () => {
    assert.doesNotMatch(source, /ANTHROPIC_API_KEY/);
    assert.doesNotMatch(source, /no API key/i);
  });

  it('renders the server-provided summary and setup guidance', () => {
    assert.match(source, /status\.summary/);
    assert.match(source, /status\.setup/);
  });

  it('disables the composer from structured configured state, whatever the backend', () => {
    assert.match(source, /!status\.configured/);
    assert.doesNotMatch(source, /noApiKey/);
  });
});

describe('composer i18n — backend-neutral unavailable copy', () => {
  const source = read('web/src/lib/i18n.js');

  it('English copy no longer claims the only fix is an API key', () => {
    const line = source.split('\n').filter((l) => l.includes("'composer.unavailable'"));
    assert.equal(line.length, 2, 'en + es entries');
    for (const l of line) {
      assert.doesNotMatch(l, /API key|clave de API/i);
      assert.match(l, /set ?up|config/i, 'copy must point at setup, not a specific credential');
    }
  });
});

describe('chat store — structured status contract', () => {
  it('documents the structured status shape it stores', () => {
    const source = read('web/src/state/chat.js');
    assert.match(source, /configured.*backend.*reason|configured.*state.*reason/,
      'status comment must describe the structured shape');
  });
});

describe('SDK env scrubbing goes through the shared helper', () => {
  const source = [
    read('server/src/lib/llm.js'),
    read('server/src/lib/provider-claude-code-runtime.js'),
  ].join('\n');

  it('imports scrubAnthropicEnv and uses it for every SDK spawn', () => {
    assert.match(source, /scrubAnthropicEnv/);
    const uses = source.match(/scrubAnthropicEnv\(\)/g) ?? [];
    assert.ok(uses.length >= 2, 'both chat streaming and tool-less completion must scrub the env');
  });

  it('no longer hand-deletes only ANTHROPIC_API_KEY', () => {
    assert.doesNotMatch(source, /delete\s+sdkEnv\.ANTHROPIC_API_KEY/);
  });
});
