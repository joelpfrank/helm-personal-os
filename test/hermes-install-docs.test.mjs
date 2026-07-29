// Regression test: HERMES-INSTALL.md and docs/MCP.md used to treat "Hermes"
// as an undefined required dependency — the install doc's title and opening
// flow assumed the reader already has a "Hermes Agent" and led with a
// Hermes-driven install, with the no-Hermes manual path buried at the
// bottom. A cold-start reader with no idea what Hermes is would be stuck.
//
// Fix under test: the install doc is retitled generically, defines what
// Hermes Agent is (an optional MCP-compatible agent host) before assuming
// any familiarity with it, leads with the direct/manual installer path, and
// makes MCP registration with it explicitly optional. docs/MCP.md gets the
// same short, honest definition at its first mention.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('HERMES-INSTALL.md — generic title, Hermes defined as optional, direct path first', () => {
  const source = () => read('HERMES-INSTALL.md');

  it('the title no longer implies Hermes is required to install Helm', () => {
    const title = source().split('\n')[0];
    assert.doesNotMatch(title, /via your Hermes Agent/i);
  });

  it('defines what Hermes Agent is, as optional, before assuming familiarity with it', () => {
    const s = source();
    const firstMention = s.search(/Hermes Agent/);
    assert.ok(firstMention >= 0, 'HERMES-INSTALL.md must still mention Hermes Agent');
    const context = s.slice(firstMention, firstMention + 400);
    assert.match(context, /optional/i, 'the first mention of Hermes Agent must say it is optional');
    assert.match(context, /MCP/i, 'the first mention should say what kind of thing Hermes Agent is (an MCP-compatible agent host)');
    assert.match(context, /https:\/\/hermes-agent\.nousresearch\.com\/docs/i,
      'the definition must link to the authoritative public Hermes Agent documentation');
  });

  it('a direct/manual install path is presented before any Hermes-driven path', () => {
    const s = source();
    const directHeading = s.search(/^##\s+.*(Direct|Manual) install/im);
    const hermesHeading = s.search(/^##\s+.*Hermes/im);
    assert.ok(directHeading >= 0, 'expected a direct/manual install section');
    assert.ok(hermesHeading >= 0, 'expected a Hermes-specific section to still exist');
    assert.ok(directHeading < hermesHeading, 'the direct/manual path must come before the Hermes-driven path');
  });

  it('MCP registration with Hermes is explicit and optional, not assumed', () => {
    const s = source();
    assert.match(s, /--no-hermes/, 'must document the flag that skips Hermes registration');
    assert.match(s, /optional/i);
  });

  it('Helm works standalone without Hermes', () => {
    assert.match(source(), /without (any )?Hermes|works fully without Hermes|no Hermes (required|needed)/i);
  });
});

describe('docs/MCP.md — Hermes is defined and marked optional at first mention', () => {
  const source = () => read('docs/MCP.md');

  it('defines Hermes as an optional MCP-compatible agent host, not an assumed dependency', () => {
    const s = source();
    const paragraph = s.split(/\n\n+/).find((p) => /Hermes/.test(p));
    assert.ok(paragraph, 'docs/MCP.md must still mention Hermes');
    assert.match(paragraph, /optional/i, 'the paragraph introducing Hermes in docs/MCP.md must call it optional');
    assert.match(paragraph, /MCP/i);
    assert.match(paragraph, /https:\/\/hermes-agent\.nousresearch\.com\/docs/i,
      'the first mention must link to the authoritative public documentation');
  });

  it('does not imply Helm itself requires Hermes to function', () => {
    const s = source();
    assert.doesNotMatch(s, /requires Hermes/i);
  });
});
