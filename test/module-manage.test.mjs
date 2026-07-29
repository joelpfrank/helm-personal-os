// TDD tests: user-facing manage/archive/restore for custom modules.
// RED first — the UI assertions must FAIL before the frontend changes.
//
// Contract: archiving is the existing non-destructive mechanism
// (modules.archived_at); items are preserved and restore brings the
// module back exactly as it was.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ═══════════════════════════════════════════════════════════════════
// A. API contract — archive is non-destructive (isolated DB, real app)
// ═══════════════════════════════════════════════════════════════════

describe('Modules API - archive/restore preserves data (isolated DB)', () => {
  let server, base, headers, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-modmanage-'));
    process.env.DASHBOARD_DB_PATH = path.join(tmpDir, 'test.db');
    const { runMigrations } = await import('../server/src/db.js');
    runMigrations();
    const { getToken } = await import('../server/src/auth.js');
    const { createApp } = await import('../server/src/app.js');
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api`;
    headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
  });

  after(() => {
    if (server) server.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function call(method, url, body) {
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }

  let modId, itemId;

  it('creates a module with an item', async () => {
    const mod = await call('POST', '/modules', {
      label: 'Meditation & breathwork',
      schema: [{ key: 'minutes', type: 'number' }],
    });
    assert.equal(mod.status, 201);
    modId = mod.body.id;
    const item = await call('POST', `/modules/${modId}/items`, { data: { minutes: 10 } });
    assert.equal(item.status, 201);
    itemId = item.body.id;
  });

  it('PATCH archived:true hides it from the active list', async () => {
    const patched = await call('PATCH', `/modules/${modId}`, { archived: true });
    assert.equal(patched.status, 200);
    assert.ok(patched.body.archived_at, 'archived_at must be set');
    const active = await call('GET', '/modules');
    assert.equal(active.body.some((m) => m.id === modId), false, 'archived module must not be in active list');
  });

  it('archived module still appears with include=archived, data intact', async () => {
    const all = await call('GET', '/modules?include=archived');
    const found = all.body.find((m) => m.id === modId);
    assert.ok(found, 'archived module must be listed with include=archived');
    assert.ok(found.archived_at);
    const items = await call('GET', `/modules/${modId}/items`);
    assert.ok(items.body.some((i) => i.id === itemId && i.data.minutes === 10), 'items must be preserved');
  });

  it('PATCH archived:false restores it to the active list', async () => {
    const patched = await call('PATCH', `/modules/${modId}`, { archived: false });
    assert.equal(patched.body.archived_at, null);
    const active = await call('GET', '/modules');
    assert.ok(active.body.some((m) => m.id === modId), 'restored module must be active again');
  });

  it('PATCH label renames the module', async () => {
    const patched = await call('PATCH', `/modules/${modId}`, { label: 'Breathwork' });
    assert.equal(patched.body.label, 'Breathwork');
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Store — archive/restore actions exist and are non-destructive
// ═══════════════════════════════════════════════════════════════════

describe('modules store exposes archive/restore', () => {
  const src = () => read('web/src/state/modules.js');

  it('has an archiveModule action that PATCHes archived:true', () => {
    assert.ok(/archiveModule/.test(src()), 'store must expose archiveModule');
    assert.ok(/archived:\s*true/.test(src()), 'archiveModule must set archived: true (not delete)');
  });

  it('has a restoreModule action that PATCHes archived:false', () => {
    assert.ok(/restoreModule/.test(src()), 'store must expose restoreModule');
    assert.ok(/archived:\s*false/.test(src()), 'restoreModule must set archived: false');
  });

  it('can fetch archived modules via include=archived', () => {
    assert.ok(src().includes('include=archived'), 'store must fetch the archived list');
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. ModuleView — obvious manage action: rename + archive w/ confirm
// ═══════════════════════════════════════════════════════════════════

describe('ModuleView manage UI', () => {
  const src = () => read('web/src/views/ModuleView.jsx');

  it('has a manage action in the module toolbar', () => {
    assert.ok(/manage/i.test(src()), 'ModuleView must offer a manage action');
  });

  it('archives via the store action, guarded by a confirmation', () => {
    assert.ok(src().includes('archiveModule'), 'must call archiveModule');
    assert.ok(/confirm\(/.test(src()), 'archiving must ask for confirmation');
  });

  it('does not offer destructive module deletion', () => {
    assert.equal(src().includes('deleteModule'), false, 'ModuleView must not hard-delete modules');
  });

  it('supports rename via updateModule with a label', () => {
    assert.ok(src().includes('updateModule'), 'must call updateModule to rename');
    assert.ok(/label:/.test(src()), 'rename must patch the label');
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. LibraryView — archived area with restore; active nav stays clean
// ═══════════════════════════════════════════════════════════════════

describe('LibraryView archived modules area', () => {
  const src = () => read('web/src/views/LibraryView.jsx');

  it('offers an archived-modules entry point', () => {
    assert.ok(/archived/i.test(src()), 'LibraryView must expose an archived area');
  });

  it('archived modules can be restored from there', () => {
    assert.ok(src().includes('restoreModule'), 'archived area must offer restore');
  });

  it('still does not expose agents or settings (boundary intact)', () => {
    const ids = [...src().matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.equal(ids.includes('agents'), false);
    assert.equal(ids.includes('settings'), false);
  });
});
