// Copy-only legacy-state migration (scripts/migrate-state.mjs).
//
// The utility moves nothing: it copies known state files from a legacy
// in-prefix layout into an external HELM_STATE_DIR layout, dry-run by default,
// refusing collisions and live services, verifying copied bytes, and always
// preserving the originals so rollback is just reverting service config.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'migrate-state.mjs');

const LEGACY_FILES = {
  'server/data/dashboard.db': 'db-bytes\n',
  'server/data/dashboard.db-wal': 'wal-bytes\n',
  '.dashboard-token': 'token-bytes\n',
  '.dashboard-password': '{"algo":"scrypt"}\n',
  '.mcp-http-token': 'mcp-token-bytes\n',
  '.google-credentials.json': '{"client_id":"x"}\n',
  '.anthropic-key': 'key-bytes\n',
};

const DEST_OF = {
  'server/data/dashboard.db': 'data/dashboard.db',
  'server/data/dashboard.db-wal': 'data/dashboard.db-wal',
  '.dashboard-token': '.dashboard-token',
  '.dashboard-password': '.dashboard-password',
  '.mcp-http-token': '.mcp-http-token',
  '.google-credentials.json': '.google-credentials.json',
  '.anthropic-key': '.anthropic-key',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeLegacy(tmp) {
  const legacy = path.join(tmp, 'legacy');
  fs.mkdirSync(path.join(legacy, 'server', 'data'), { recursive: true });
  for (const [rel, content] of Object.entries(LEGACY_FILES)) {
    fs.writeFileSync(path.join(legacy, rel), content, { mode: 0o600 });
  }
  return legacy;
}

function run(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.HELM_STATE_DIR;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env, encoding: 'utf8', timeout: 60_000,
  });
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'helm-migrate-'));
}

describe('migrate-state.mjs dry-run default', () => {
  it('prints a plan and copies nothing without --apply', () => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const dest = path.join(tmp, 'state');
    const res = run(['--from', legacy, '--to', dest]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /dry[- ]run/i);
    assert.ok(res.stdout.includes('.dashboard-token'), 'plan must list files to copy');
    assert.ok(!fs.existsSync(dest), 'dry-run must not create the destination');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('migrate-state.mjs --apply', () => {
  it('copies every known state file, verifies bytes, restricts permissions, preserves originals', () => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const dest = path.join(tmp, 'state');
    const originals = Object.fromEntries(
      Object.keys(LEGACY_FILES).map((rel) => [rel, sha256(path.join(legacy, rel))]),
    );

    const res = run(['--from', legacy, '--to', dest, '--apply']);
    assert.equal(res.status, 0, res.stderr);

    for (const [srcRel, destRel] of Object.entries(DEST_OF)) {
      const src = path.join(legacy, srcRel);
      const copy = path.join(dest, destRel);
      assert.ok(fs.existsSync(copy), `${destRel} must be copied`);
      assert.equal(sha256(copy), originals[srcRel], `${destRel} bytes must match the source`);
      assert.equal(fs.statSync(copy).mode & 0o777, 0o600, `${destRel} must be chmod 600`);
      assert.ok(fs.existsSync(src), `${srcRel} original must be preserved`);
      assert.equal(sha256(src), originals[srcRel], `${srcRel} original must be unmodified`);
    }
    for (const dir of [dest, path.join(dest, 'data')]) {
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700, `${dir} must be chmod 700`);
    }
    assert.match(res.stdout, /verified/i);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('skips missing sources and succeeds when only some state files exist', () => {
    const tmp = tmpdir();
    const legacy = path.join(tmp, 'legacy');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, '.dashboard-token'), 'only-token\n', { mode: 0o600 });
    const dest = path.join(tmp, 'state');
    const res = run(['--from', legacy, '--to', dest, '--apply']);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(dest, '.dashboard-token')));
    assert.ok(!fs.existsSync(path.join(dest, 'data', 'dashboard.db')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('migrate-state.mjs refusals', () => {
  it('refuses any destination collision before copying anything', () => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const dest = path.join(tmp, 'state');
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dest, '.dashboard-token'), 'pre-existing\n', { mode: 0o600 });

    const res = run(['--from', legacy, '--to', dest, '--apply']);
    assert.notEqual(res.status, 0, 'collision must be refused');
    assert.match(res.stderr, /collision|already exists/i);
    assert.equal(fs.readFileSync(path.join(dest, '.dashboard-token'), 'utf8'), 'pre-existing\n',
      'existing destination file must not be overwritten');
    assert.ok(!fs.existsSync(path.join(dest, 'data', 'dashboard.db')),
      'no partial copy may happen after a collision is detected');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses relative paths and nested from/to combinations', () => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    assert.notEqual(run(['--from', 'legacy', '--to', path.join(tmp, 's'), '--apply']).status, 0);
    assert.notEqual(run(['--from', legacy, '--to', 'state', '--apply']).status, 0);
    assert.notEqual(run(['--from', legacy, '--to', path.join(legacy, 'state'), '--apply']).status, 0);
    assert.notEqual(run(['--from', legacy, '--to', legacy, '--apply']).status, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses a --to that is only nested inside --from once a symlinked ancestor is resolved physically', () => {
    // --from is given through a symlinked alias directory; --to is given
    // through the alias's real target. The two argument strings share no
    // textual prefix, but they name the same physical subtree, so --to is
    // physically inside --from and must be refused just like a literal
    // nested path.
    const tmp = tmpdir();
    fs.mkdirSync(path.join(tmp, 'actual'), { recursive: true });
    fs.symlinkSync(path.join(tmp, 'actual'), path.join(tmp, 'legacy-alias'), 'dir');
    const from = path.join(tmp, 'legacy-alias', 'legacy');
    fs.mkdirSync(from, { recursive: true });
    const to = path.join(tmp, 'actual', 'legacy', 'state');

    const res = run(['--from', from, '--to', to]);
    assert.notEqual(res.status, 0, 'a physically-nested --to must be refused even via a symlinked --from alias');
    assert.match(res.stderr, /nested/i);
    assert.ok(!fs.existsSync(to));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses to migrate while the legacy service appears to be running', () => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    fs.writeFileSync(path.join(legacy, 'server', 'data', 'helm.pid'), `${process.pid}\n`);
    const res = run(['--from', legacy, '--to', path.join(tmp, 'state'), '--apply']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /running|stop/i);
    assert.ok(!fs.existsSync(path.join(tmp, 'state')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detects a running legacy entrypoint invoked with a relative argv path and no pidfile', async (t) => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const entrypoint = path.join(legacy, 'server', 'src', 'index.js');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, 'setInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [path.join('server', 'src', 'index.js')],
      { cwd: legacy, stdio: 'ignore' });
    t.after(() => {
      try { child.kill('SIGTERM'); } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const dest = path.join(tmp, 'state');
    const res = run(['--from', legacy, '--to', dest]);
    assert.notEqual(res.status, 0, 'a relative-argv invocation of the legacy entrypoint must still be detected');
    assert.match(res.stderr, /running|stop/i);
    assert.ok(!fs.existsSync(dest));
  });

  it('fails closed for a relative legacy entrypoint when lsof cannot resolve its cwd', async (t) => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const entrypoint = path.join(legacy, 'server', 'src', 'index.js');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, 'setInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [path.join('server', 'src', 'index.js')],
      { cwd: legacy, stdio: 'ignore' });
    const fakeBin = path.join(tmp, 'bin');
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, 'lsof'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
    t.after(() => {
      try { child.kill('SIGTERM'); } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const dest = path.join(tmp, 'state');
    const res = run(['--from', legacy, '--to', dest], {
      PATH: `${fakeBin}:${process.env.PATH}`,
    });
    assert.notEqual(res.status, 0,
      'uncertain cwd for a matching relative entrypoint must refuse migration');
    assert.match(res.stderr, /running|inspect|lsof|stop/i);
    assert.ok(!fs.existsSync(dest));
  });

  it('detects a running legacy entrypoint even when no pidfile exists', async (t) => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const entrypoint = path.join(legacy, 'server', 'src', 'index.js');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, 'setInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [entrypoint], { stdio: 'ignore' });
    t.after(() => {
      try { child.kill('SIGTERM'); } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const dest = path.join(tmp, 'state');
    const res = run(['--from', legacy, '--to', dest]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /running|stop/i);
    assert.ok(!fs.existsSync(dest));
  });

  it('fails and removes the bad copy when byte verification does not match', () => {
    const tmp = tmpdir();
    const legacy = makeLegacy(tmp);
    const dest = path.join(tmp, 'state');
    const res = run(['--from', legacy, '--to', dest, '--apply'],
      { HELM_MIGRATE_TEST_CORRUPT: '.dashboard-token' });
    assert.notEqual(res.status, 0, 'verification mismatch must fail the migration');
    assert.match(res.stderr, /verif/i);
    assert.ok(!fs.existsSync(path.join(dest, '.dashboard-token')),
      'the corrupt copy must not be left behind');
    assert.equal(fs.readFileSync(path.join(legacy, '.dashboard-token'), 'utf8'),
      'token-bytes\n', 'source must remain untouched');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses both preview and apply when the legacy root contains no state', () => {
    const tmp = tmpdir();
    const legacy = path.join(tmp, 'empty-legacy');
    fs.mkdirSync(legacy, { recursive: true });
    const dest = path.join(tmp, 'state');

    for (const args of [
      ['--from', legacy, '--to', dest],
      ['--from', legacy, '--to', dest, '--apply'],
    ]) {
      const res = run(args);
      assert.notEqual(res.status, 0, 'zero-state migration must not report success');
      assert.match(res.stderr, /no.*state|nothing.*copy/i);
      assert.ok(!fs.existsSync(dest));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('documents rollback as service-config reversion, never deletion', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(text, /rollback/i);
    assert.ok(!/fs\.(rmSync|unlinkSync)\([^)]*from/i.test(text),
      'the migration script must never delete from the legacy source');
  });
});
