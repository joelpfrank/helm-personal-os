// Regression test: Agents and Connections must be hidden from Helm's
// primary Library UI, while all backend infrastructure stays intact.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ── LibraryView must NOT expose Agents or Connections nav ──────────

describe('LibraryView navigation', () => {
  const src = () => read('web/src/views/LibraryView.jsx');

  it('COLLECTIONS must not contain agents entry', () => {
    assert.equal(/id:\s*'agents'/.test(src()), false,
      'COLLECTIONS should not list agents');
  });

  it('COLLECTIONS must not contain settings entry', () => {
    assert.equal(/id:\s*'settings'/.test(src()), false,
      'COLLECTIONS should not list settings');
  });

  it('must not import AgentsView', () => {
    assert.equal(src().includes('AgentsView'), false,
      'LibraryView should not import AgentsView');
  });

  it('must not import SettingsView', () => {
    assert.equal(src().includes('SettingsView'), false,
      'LibraryView should not import SettingsView');
  });

  it('must not render <AgentsView />', () => {
    assert.equal(src().includes('<AgentsView'), false,
      'LibraryView should not render AgentsView');
  });

  it('must not render <SettingsView />', () => {
    assert.equal(src().includes('<SettingsView'), false,
      'LibraryView should not render SettingsView');
  });

  it('stale lib=agents hash must not match any COLLECTIONS id', () => {
    // readCollection falls back to goals when c is not in COLLECTIONS
    const ids = [...src().matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
    assert.equal(ids.includes('agents'), false,
      'agents must not be a valid collection id');
  });

  it('stale lib=settings hash must not match any COLLECTIONS id', () => {
    const ids = [...src().matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
    assert.equal(ids.includes('settings'), false,
      'settings must not be a valid collection id');
  });
});

// ── Backend files must still exist (Hermes may use them) ───────────

describe('Backend infrastructure retained', () => {
  it('AgentsView.jsx still exists', () => {
    assert.ok(exists('web/src/views/AgentsView.jsx'),
      'AgentsView.jsx must not be deleted');
  });

  it('SettingsView.jsx still exists', () => {
    assert.ok(exists('web/src/views/SettingsView.jsx'),
      'SettingsView.jsx must not be deleted');
  });

  it('agents state store still exists', () => {
    assert.ok(exists('web/src/state/agents.js'),
      'agents.js store must not be deleted');
  });

  it('mcpServers state store still exists', () => {
    assert.ok(exists('web/src/state/mcpServers.js'),
      'mcpServers.js store must not be deleted');
  });

  it('server agents route still exists', () => {
    assert.ok(exists('server/src/routes/agents.js'),
      'server agents route must not be deleted');
  });

  it('server mcp-servers route still exists', () => {
    assert.ok(exists('server/src/routes/mcp-servers.js'),
      'server mcp-servers route must not be deleted');
  });
});
