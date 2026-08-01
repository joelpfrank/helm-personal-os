// install-helm.sh external-state safety: --state-dir wiring, upgrade
// preservation, and rollback that never touches external state.
//
// Runs the real installer against a minimal fixture source tree with
// HELM_INSTALL_TEST_SKIP_BUILD=1 (test hook: skips npm ci / frontend build) so
// the swap/rollback machinery is exercised hermetically and offline.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

let TMP;
let SRC;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(file) {
  return { sha: sha256(file), ino: fs.statSync(file).ino };
}

function assertUntouched(file, before, label) {
  const now = snapshot(file);
  assert.equal(now.sha, before.sha, `${label}: bytes must be unchanged`);
  assert.equal(now.ino, before.ino, `${label}: inode must be unchanged (no rewrite)`);
}

function writeFixtureSource(dir) {
  fs.mkdirSync(path.join(dir, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'launchd'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'install-helm.sh'), path.join(dir, 'install-helm.sh'));
  fs.chmodSync(path.join(dir, 'install-helm.sh'), 0o755);
  for (const f of ['launchd/com.helm.app.plist.template', 'launchd/helm-launch.sh']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"helm-installer-fixture"}\n');
  fs.writeFileSync(path.join(dir, 'server', 'src', 'index.js'), '// fixture server\n');
  fs.writeFileSync(path.join(dir, 'SOURCE_MARKER.txt'), 'v1\n');
}

function seedState(stateDir) {
  fs.mkdirSync(path.join(stateDir, 'data'), { recursive: true, mode: 0o700 });
  const files = {
    'data/dashboard.db': 'sqlite-sentinel-bytes\n',
    '.dashboard-token': 'sentinel-token\n',
    '.dashboard-password': '{"algo":"scrypt"}\n',
    '.mcp-http-token': 'sentinel-mcp-token\n',
    '.google-credentials.json': '{"client_id":"sentinel"}\n',
    '.anthropic-key': 'sentinel-key\n',
  };
  const snaps = {};
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(stateDir, rel);
    fs.writeFileSync(abs, content, { mode: 0o600 });
    snaps[rel] = snapshot(abs);
  }
  return snaps;
}

function runInstaller(args, extraEnv = {}) {
  const env = { ...process.env, HELM_INSTALL_TEST_SKIP_BUILD: '1', ...extraEnv };
  delete env.HELM_HOME;
  delete env.HELM_PORT;
  if (!('HELM_STATE_DIR' in extraEnv)) delete env.HELM_STATE_DIR;
  return spawnSync('bash', [path.join(SRC, 'install-helm.sh'), ...args], {
    env, encoding: 'utf8', timeout: 120_000,
  });
}

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-installer-state-'));
  SRC = path.join(TMP, 'src');
  writeFixtureSource(SRC);
});
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('install-helm.sh --state-dir argument handling', () => {
  it('dry-run prints the external state plan and touches nothing', () => {
    const stateDir = path.join(TMP, 'dry-state');
    const res = runInstaller([
      '--prefix', path.join(TMP, 'dry-prefix'),
      '--state-dir', stateDir,
      '--dry-run', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /state dir/i);
    assert.ok(res.stdout.includes(stateDir), 'plan must show the state dir path');
    assert.ok(!fs.existsSync(stateDir), 'dry-run must not create the state dir');
    assert.ok(!fs.existsSync(path.join(TMP, 'dry-prefix')), 'dry-run must not create the prefix');
  });

  it('rejects a relative state dir', () => {
    const res = runInstaller([
      '--prefix', path.join(TMP, 'p1'), '--state-dir', 'relative/state',
      '--dry-run', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /absolute/i);
  });

  it('rejects a state dir inside the prefix and vice versa', () => {
    const prefix = path.join(TMP, 'p2');
    const inside = runInstaller([
      '--prefix', prefix, '--state-dir', path.join(prefix, 'state'),
      '--dry-run', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(inside.status, 2);
    const around = runInstaller([
      '--prefix', path.join(TMP, 'p3', 'app'), '--state-dir', path.join(TMP, 'p3'),
      '--dry-run', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(around.status, 2);
  });

  it('rejects a state dir that is only nested inside the prefix once a symlinked alias is resolved physically', () => {
    // --prefix is given through a symlinked alias directory; --state-dir is
    // given through the alias's real target. The two argument strings share
    // no textual prefix, but they name the same physical subtree, so
    // --state-dir is physically inside the prefix and must be refused just
    // like a literal nested path.
    const base = path.join(TMP, 'symlink-alias');
    fs.mkdirSync(path.join(base, 'actual'), { recursive: true });
    fs.symlinkSync(path.join(base, 'actual'), path.join(base, 'prefix-alias'), 'dir');
    const prefix = path.join(base, 'prefix-alias', 'app');
    const stateDir = path.join(base, 'actual', 'app', 'state');

    const res = runInstaller([
      '--prefix', prefix, '--state-dir', stateDir,
      '--dry-run', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /outside the install prefix/i);
    assert.ok(!fs.existsSync(stateDir), 'rejected dry-run must not create the state dir');
  });

  it('normalizes a relative prefix before checking state-dir separation', () => {
    const relativePrefix = path.relative(process.cwd(), path.join(TMP, 'relative-prefix'));
    const nestedState = path.resolve(relativePrefix, 'state');
    const res = runInstaller([
      '--prefix', relativePrefix, '--state-dir', nestedState,
      '--dry-run', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /outside the install prefix/i);
  });

  it('renders the state dir into the LaunchAgent template and launcher', () => {
    const installer = fs.readFileSync(path.join(ROOT, 'install-helm.sh'), 'utf8');
    assert.ok(installer.includes('{{STATE_DIR}}'), 'installer must substitute {{STATE_DIR}}');
    assert.match(installer, /--state-dir/, 'installer must document --state-dir');
  });
});

describe('install-helm.sh external-state safety', () => {
  it('fresh install with pre-existing external state leaves it byte-identical', () => {
    const prefix = path.join(TMP, 'app');
    const stateDir = path.join(TMP, 'state');
    const snaps = seedState(stateDir);

    const res = runInstaller([
      '--prefix', prefix, '--state-dir', stateDir, '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(path.join(prefix, 'SOURCE_MARKER.txt'), 'utf8'), 'v1\n');
    for (const [rel, snap] of Object.entries(snaps)) {
      assertUntouched(path.join(stateDir, rel), snap, `fresh install ${rel}`);
    }
    assert.ok(!fs.existsSync(path.join(prefix, '.dashboard-token')),
      'state files must not be copied into the replaceable prefix');
    assert.ok(res.stdout.includes(path.join(stateDir, '.dashboard-token')),
      'summary must identify the external token location');
    assert.ok(res.stdout.includes(path.join(stateDir, 'data')),
      'summary must identify the external data location');
  });

  it('upgrade swaps code but never rewrites external state', () => {
    const prefix = path.join(TMP, 'app');
    const stateDir = path.join(TMP, 'state');
    const snaps = Object.fromEntries(
      ['data/dashboard.db', '.dashboard-token', '.dashboard-password', '.mcp-http-token',
        '.google-credentials.json', '.anthropic-key']
        .map((rel) => [rel, snapshot(path.join(stateDir, rel))]),
    );

    fs.writeFileSync(path.join(SRC, 'SOURCE_MARKER.txt'), 'v2\n');
    const res = runInstaller([
      '--prefix', prefix, '--state-dir', stateDir, '--upgrade', '--no-launchagent', '--no-hermes',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(path.join(prefix, 'SOURCE_MARKER.txt'), 'utf8'), 'v2\n');
    for (const [rel, snap] of Object.entries(snaps)) {
      assertUntouched(path.join(stateDir, rel), snap, `upgrade ${rel}`);
    }
  });

  it('failed upgrade rolls back the prefix and leaves external state untouched', () => {
    const prefix = path.join(TMP, 'app');
    const stateDir = path.join(TMP, 'state');
    const snaps = Object.fromEntries(
      ['data/dashboard.db', '.dashboard-token', '.anthropic-key']
        .map((rel) => [rel, snapshot(path.join(stateDir, rel))]),
    );

    fs.writeFileSync(path.join(SRC, 'SOURCE_MARKER.txt'), 'v3\n');
    const res = runInstaller(
      ['--prefix', prefix, '--state-dir', stateDir, '--upgrade', '--no-launchagent', '--no-hermes'],
      { HELM_INSTALL_TEST_FAIL_AFTER_SWAP: '1' },
    );
    assert.notEqual(res.status, 0, 'installer must fail when the post-swap hook fires');
    assert.equal(fs.readFileSync(path.join(prefix, 'SOURCE_MARKER.txt'), 'utf8'), 'v2\n',
      'rollback must restore the previous code release');
    for (const [rel, snap] of Object.entries(snaps)) {
      assertUntouched(path.join(stateDir, rel), snap, `rollback ${rel}`);
    }
  });

  it('restores an existing external Anthropic key when a later install step fails', () => {
    const prefix = path.join(TMP, 'key-rollback-app');
    const stateDir = path.join(TMP, 'key-rollback-state');
    fs.mkdirSync(path.join(stateDir, 'data'), { recursive: true, mode: 0o700 });
    const keyFile = path.join(stateDir, '.anthropic-key');
    fs.writeFileSync(keyFile, 'original-key\n', { mode: 0o600 });
    const before = snapshot(keyFile);

    const res = runInstaller([
      '--prefix', prefix,
      '--state-dir', stateDir,
      '--anthropic-key', 'replacement-key',
      '--no-launchagent', '--no-hermes',
    ], { HELM_INSTALL_TEST_FAIL_AFTER_KEY_WRITE: '1' });

    assert.notEqual(res.status, 0, 'the post-key test hook must fail the install');
    assert.equal(sha256(keyFile), before.sha, 'external key rollback must restore the original bytes');
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600,
      'external key rollback must preserve owner-only permissions');
    assert.ok(!fs.existsSync(prefix), 'failed fresh install must remove the new code prefix');
  });

  it('removes a newly-created external Anthropic key when a later install step fails', () => {
    const prefix = path.join(TMP, 'new-key-rollback-app');
    const stateDir = path.join(TMP, 'new-key-rollback-state');
    const keyFile = path.join(stateDir, '.anthropic-key');

    const res = runInstaller([
      '--prefix', prefix,
      '--state-dir', stateDir,
      '--anthropic-key', 'new-key',
      '--no-launchagent', '--no-hermes',
    ], { HELM_INSTALL_TEST_FAIL_AFTER_KEY_WRITE: '1' });

    assert.notEqual(res.status, 0);
    assert.ok(!fs.existsSync(keyFile), 'rollback must remove a key created by the failed attempt');
  });

  it('legacy layout (no --state-dir) still preserves in-prefix data across upgrades', () => {
    const prefix = path.join(TMP, 'legacy-app');
    const fresh = runInstaller(['--prefix', prefix, '--no-launchagent', '--no-hermes']);
    assert.equal(fresh.status, 0, fresh.stderr);

    fs.mkdirSync(path.join(prefix, 'server', 'data'), { recursive: true });
    fs.writeFileSync(path.join(prefix, 'server', 'data', 'dashboard.db'), 'legacy-db\n');
    fs.writeFileSync(path.join(prefix, '.dashboard-token'), 'legacy-token\n', { mode: 0o600 });

    const up = runInstaller(['--prefix', prefix, '--upgrade', '--no-launchagent', '--no-hermes']);
    assert.equal(up.status, 0, up.stderr);
    assert.equal(fs.readFileSync(path.join(prefix, 'server', 'data', 'dashboard.db'), 'utf8'), 'legacy-db\n');
    assert.equal(fs.readFileSync(path.join(prefix, '.dashboard-token'), 'utf8'), 'legacy-token\n');
  });
});

describe('helm-launch.sh key resolution', () => {
  it('reads the Anthropic key from HELM_STATE_DIR when set, project root otherwise', () => {
    const project = path.join(TMP, 'launch-project');
    fs.mkdirSync(path.join(project, 'launchd'), { recursive: true });
    fs.mkdirSync(path.join(project, 'server', 'src'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'launchd', 'helm-launch.sh'),
      path.join(project, 'launchd', 'helm-launch.sh'));
    fs.writeFileSync(path.join(project, 'server', 'src', 'index.js'), '');
    const stub = path.join(TMP, 'node-stub.sh');
    fs.writeFileSync(stub, '#!/bin/bash\necho "key=${ANTHROPIC_API_KEY:-none} backend=${LLM_BACKEND:-default}"\n');
    fs.chmodSync(stub, 0o755);

    const stateDir = path.join(TMP, 'launch-state');
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(stateDir, '.anthropic-key'), 'state-key\n', { mode: 0o600 });
    fs.writeFileSync(path.join(project, '.anthropic-key'), 'legacy-key\n', { mode: 0o600 });

    const run = (env) => spawnSync('bash', [path.join(project, 'launchd', 'helm-launch.sh')], {
      env: { ...process.env, HELM_NODE_BIN: stub, ...env }, encoding: 'utf8', timeout: 30_000,
    });

    const withState = run({ HELM_STATE_DIR: stateDir });
    assert.equal(withState.status, 0, withState.stderr);
    assert.match(withState.stdout, /key=state-key backend=api/);

    const legacyEnv = { ...process.env, HELM_NODE_BIN: stub };
    delete legacyEnv.HELM_STATE_DIR;
    const legacy = spawnSync('bash', [path.join(project, 'launchd', 'helm-launch.sh')], {
      env: legacyEnv, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.match(legacy.stdout, /key=legacy-key backend=api/);
  });
});
