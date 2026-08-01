// External state-directory contract (HELM_STATE_DIR).
//
// One module — server/src/lib/state-paths.js — decides where every mutable or
// private runtime file lives. Unset HELM_STATE_DIR must preserve the historical
// repository-local locations byte-for-byte so existing installs keep working.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { maintainerOnly } from '../scripts/lib/tree-context.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

const sp = await import('../server/src/lib/state-paths.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-state-paths-'));
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('stateRoot resolution', () => {
  it('is null when HELM_STATE_DIR is unset', () => {
    assert.equal(sp.stateRoot({}), null);
  });

  it('treats empty and whitespace-only values as unset', () => {
    assert.equal(sp.stateRoot({ HELM_STATE_DIR: '' }), null);
    assert.equal(sp.stateRoot({ HELM_STATE_DIR: '   ' }), null);
  });

  it('returns the resolved absolute path when set', () => {
    const dir = path.join(TMP, 'state');
    assert.equal(sp.stateRoot({ HELM_STATE_DIR: dir }), dir);
    assert.equal(sp.stateRoot({ HELM_STATE_DIR: dir + '/' }), dir);
  });

  it('rejects relative paths', () => {
    assert.throws(() => sp.stateRoot({ HELM_STATE_DIR: 'relative/state' }), /absolute/);
  });

  it('rejects control characters in the path', () => {
    assert.throws(() => sp.stateRoot({ HELM_STATE_DIR: '/tmp/bad\nname' }));
    assert.throws(() => sp.stateRoot({ HELM_STATE_DIR: '/tmp/bad\0name' }));
  });

  it('rejects state physically nested in the replaceable product tree through a symlink alias', () => {
    const alias = path.join(TMP, 'product-alias');
    fs.symlinkSync(ROOT, alias, 'dir');
    assert.throws(
      () => sp.stateRoot({ HELM_STATE_DIR: path.join(alias, 'external-looking-state') }),
      /outside.*product|replaceable/i,
    );
  });
});

describe('path contract', () => {
  const S = path.join(TMP, 'contract');
  const env = { HELM_STATE_DIR: S };

  it('keeps legacy defaults when unset (backwards compatible)', () => {
    assert.equal(sp.dbPath({}), path.join(ROOT, 'server', 'data', 'dashboard.db'));
    assert.equal(sp.dashboardTokenPath({}), path.join(ROOT, '.dashboard-token'));
    assert.equal(sp.passwordFilePath({}), path.join(ROOT, '.dashboard-password'));
    assert.equal(sp.mcpHttpTokenPath({}), path.join(ROOT, '.mcp-http-token'));
    assert.equal(sp.googleCredentialsPath({}), path.join(ROOT, '.google-credentials.json'));
    assert.equal(sp.anthropicKeyPath({}), path.join(ROOT, '.anthropic-key'));
    assert.equal(sp.dataDir({}), path.join(ROOT, 'server', 'data'));
  });

  it('moves every mutable/private file under the state dir when set', () => {
    assert.equal(sp.dbPath(env), path.join(S, 'data', 'dashboard.db'));
    assert.equal(sp.dashboardTokenPath(env), path.join(S, '.dashboard-token'));
    assert.equal(sp.passwordFilePath(env), path.join(S, '.dashboard-password'));
    assert.equal(sp.mcpHttpTokenPath(env), path.join(S, '.mcp-http-token'));
    assert.equal(sp.googleCredentialsPath(env), path.join(S, '.google-credentials.json'));
    assert.equal(sp.anthropicKeyPath(env), path.join(S, '.anthropic-key'));
    assert.equal(sp.dataDir(env), path.join(S, 'data'));
  });

  it('lets the narrower DASHBOARD_DB_PATH override win over HELM_STATE_DIR', () => {
    const dbFile = path.join(TMP, 'override.db');
    assert.equal(sp.dbPath({ HELM_STATE_DIR: S, DASHBOARD_DB_PATH: dbFile }), dbFile);
  });
});

describe('ensureStateDir', () => {
  it('is a no-op returning null when unset', () => {
    assert.equal(sp.ensureStateDir({}), null);
  });

  it('creates the root and data dirs with 0700 permissions', () => {
    const S = path.join(TMP, 'created');
    assert.equal(sp.ensureStateDir({ HELM_STATE_DIR: S }), S);
    for (const dir of [S, path.join(S, 'data')]) {
      const st = fs.statSync(dir);
      assert.ok(st.isDirectory(), `${dir} must be a directory`);
      assert.equal(st.mode & 0o777, 0o700, `${dir} must be chmod 700`);
    }
  });

  it('refuses a state path occupied by a regular file', () => {
    const S = path.join(TMP, 'occupied');
    fs.writeFileSync(S, 'not a directory\n');
    assert.throws(() => sp.ensureStateDir({ HELM_STATE_DIR: S }));
  });

  it('fails closed when owner-only permissions cannot be enforced', () => {
    const S = path.join(TMP, 'chmod-refused');
    const refusingFs = {
      ...fs,
      chmodSync() { throw new Error('chmod denied'); },
    };
    assert.throws(
      () => sp.ensureStateDir({ HELM_STATE_DIR: S }, refusingFs),
      /chmod denied/,
    );
  });
});

describe('call-site wiring', () => {
  it('auth and password modules resolve through the contract at call time', async () => {
    const auth = await import('../server/src/auth.js');
    const password = await import('../server/src/password.js');
    const S = path.join(TMP, 'wired');
    const prev = process.env.HELM_STATE_DIR;
    try {
      process.env.HELM_STATE_DIR = S;
      assert.equal(auth.tokenPath(), path.join(S, '.dashboard-token'));
      assert.equal(password.passwordPath(), path.join(S, '.dashboard-password'));
      delete process.env.HELM_STATE_DIR;
      assert.equal(auth.tokenPath(), path.join(ROOT, '.dashboard-token'));
      assert.equal(password.passwordPath(), path.join(ROOT, '.dashboard-password'));
    } finally {
      if (prev === undefined) delete process.env.HELM_STATE_DIR;
      else process.env.HELM_STATE_DIR = prev;
    }
  });

  it('every credential call site imports the shared contract module', () => {
    const expectations = [
      ['server/src/db.js', 'lib/state-paths.js'],
      ['server/src/auth.js', 'lib/state-paths.js'],
      ['server/src/password.js', 'lib/state-paths.js'],
      ['server/src/lib/google.js', 'state-paths.js'],
      ['server/src/routes/mcp-servers.js', 'state-paths.js'],
      ['mcp/src/api.js', 'server/src/lib/state-paths.js'],
      ['mcp/src/http.js', 'server/src/lib/state-paths.js'],
    ];
    for (const [file, marker] of expectations) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(text.includes(marker), `${file} must resolve paths via ${marker}`);
    }
  });

  // start.sh and stop.sh are development helpers that the portable archive does
  // not carry; the LaunchAgent it does carry is asserted for every recipient.
  it('the development start/stop scripts honor HELM_STATE_DIR', {
    skip: maintainerOnly('the start.sh and stop.sh contract'),
  }, () => {
    for (const file of ['start.sh', 'stop.sh']) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(text.includes('HELM_STATE_DIR'), `${file} must honor HELM_STATE_DIR`);
    }
  });

  it('the LaunchAgent honors HELM_STATE_DIR', () => {
    const launcher = fs.readFileSync(path.join(ROOT, 'launchd', 'helm-launch.sh'), 'utf8');
    assert.ok(launcher.includes('HELM_STATE_DIR'), 'helm-launch.sh must honor HELM_STATE_DIR');
    const template = fs.readFileSync(
      path.join(ROOT, 'launchd', 'com.helm.app.plist.template'), 'utf8');
    assert.ok(template.includes('HELM_STATE_DIR'), 'plist template must carry HELM_STATE_DIR');
    assert.ok(template.includes('{{STATE_DIR}}'), 'plist template must expose a {{STATE_DIR}} slot');
  });

  it('the Vite development proxy reads the dashboard token from HELM_STATE_DIR', async () => {
    const vite = await import('../web/vite.config.js');
    const S = path.join(TMP, 'vite-state');
    assert.equal(vite.dashboardTokenFile({ HELM_STATE_DIR: S }), path.join(S, '.dashboard-token'));
    assert.equal(vite.dashboardTokenFile({}), path.join(ROOT, '.dashboard-token'));
  });
});
