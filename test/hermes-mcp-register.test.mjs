// M13: install-helm.sh's Hermes MCP registration used a bare `hermes mcp add
// helm ...` call. Live Hermes (v0.18.2) inserts an interactive
// "Enable all 112 tools? [Y/n/select]" prompt before it persists anything;
// under the installer's non-interactive stdin, that prompt hit EOF,
// cancelled, and left nothing registered — while the installer still
// reported success. These tests drive the real installer against a
// realistic fake `hermes` CLI (test/fixtures/fake-hermes-cli/hermes) that
// reproduces that prompt, a hang, and a persists-but-unreachable case, and
// assert the installer answers the prompt itself, bounds every call, and
// only ever claims success once `hermes mcp test helm` actually confirms it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE_HERMES_DIR = path.join(ROOT, 'test', 'fixtures', 'fake-hermes-cli');

let TMP;
let SRC;

function writeFixtureSource(dir) {
  fs.mkdirSync(path.join(dir, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'mcp', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'launchd'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'install-helm.sh'), path.join(dir, 'install-helm.sh'));
  fs.chmodSync(path.join(dir, 'install-helm.sh'), 0o755);
  for (const f of ['launchd/com.helm.app.plist.template', 'launchd/helm-launch.sh']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"helm-installer-fixture"}\n');
  fs.writeFileSync(path.join(dir, 'server', 'src', 'index.js'), '// fixture server\n');
  fs.writeFileSync(path.join(dir, 'mcp', 'src', 'index.js'), '// fixture mcp entry\n');
}

const INSTALLER_PATH = `${FAKE_HERMES_DIR}:${process.env.PATH}`;

// The installer resolves `node` from PATH, which is not necessarily the same
// binary running this test file (npm and node can come from different
// installs). Assert against the node the installer will actually pick.
function installerNode() {
  const res = spawnSync('bash', ['-c', 'command -v node'], {
    env: { ...process.env, PATH: INSTALLER_PATH }, encoding: 'utf8',
  });
  return res.stdout.trim();
}

function runInstaller(args, { mode, stateFile, extraEnv = {}, timeout = 60_000 } = {}) {
  const env = {
    ...process.env,
    HELM_INSTALL_TEST_SKIP_BUILD: '1',
    PATH: INSTALLER_PATH,
    FAKE_HERMES_MODE: mode || 'normal',
    FAKE_HERMES_STATE: stateFile,
    // Keep bounded-timeout tests fast without changing production defaults.
    // The canonical runner bounds file-level concurrency; retain enough room
    // for ordinary scheduler delay without changing production defaults.
    HELM_HERMES_TIMEOUT_MS: mode === 'hang' ? '5000' : '15000',
    ...extraEnv,
  };
  delete env.HELM_HOME;
  delete env.HELM_PORT;
  delete env.HELM_STATE_DIR;
  return spawnSync('bash', [path.join(SRC, 'install-helm.sh'), '--no-launchagent', ...args], {
    env, encoding: 'utf8', timeout,
  });
}

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-hermes-register-'));
  SRC = path.join(TMP, 'src');
  writeFixtureSource(SRC);
});
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('install-helm.sh Hermes registration against a realistic v0.18.2-style CLI', () => {
  it('answers the tool-selection prompt itself and only claims success once `hermes mcp test` confirms it', () => {
    const prefix = path.join(TMP, 'app-normal');
    const stateFile = path.join(TMP, 'registry-normal.json');
    const res = runInstaller(['--prefix', prefix], { mode: 'normal', stateFile });

    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /registered and verified/i);
    assert.match(res.stdout, /Tools discovered:\s*112/);

    const registry = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(registry.helm, 'helm must be persisted in the fake Hermes registry');
    assert.equal(registry.helm.tools, 112);
    assert.ok(registry.helm.args[0].endsWith('mcp/src/index.js'));
    assert.match(registry.helm.env.DASHBOARD_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('passes external state to the MCP process and keeps --args last for live Hermes argparse', () => {
    const prefix = path.join(TMP, 'app-external-state');
    const stateDir = path.join(TMP, 'external-state');
    const stateFile = path.join(TMP, 'registry-external-state.json');
    const res = runInstaller(['--prefix', prefix, '--state-dir', stateDir], {
      mode: 'normal', stateFile,
    });

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const registry = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(registry.helm.env.HELM_STATE_DIR, stateDir);
    assert.equal(registry.helm.args.length, 1,
      '--args must be last; Hermes options must not leak into the child argv');
    assert.ok(registry.helm.args[0].endsWith('mcp/src/index.js'));
  });

  it('replaces an existing persisted registration with this install instead of testing the stale server', () => {
    const prefix = path.join(TMP, 'app-replace-existing');
    const stateDir = path.join(TMP, 'external-state-replace-existing');
    const stateFile = path.join(TMP, 'registry-replace-existing.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      helm: {
        command: '/previous/node',
        args: ['/previous/helm/mcp/src/index.js'],
        env: { DASHBOARD_URL: 'http://127.0.0.1:7777' },
        tools: 112,
      },
    }));

    const res = runInstaller(['--prefix', prefix, '--state-dir', stateDir], {
      mode: 'normal', stateFile,
    });

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const registry = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(registry.helm.command, installerNode());
    assert.deepEqual(registry.helm.args, [path.join(prefix, 'mcp', 'src', 'index.js')]);
    assert.equal(registry.helm.env.HELM_STATE_DIR, stateDir);
    assert.match(res.stdout, /registered and verified/i);
  });

  it('rejects a zero-exit overwrite cancellation instead of verifying the stale registration', () => {
    const prefix = path.join(TMP, 'app-overwrite-cancel');
    const stateDir = path.join(TMP, 'external-state-overwrite-cancel');
    const stateFile = path.join(TMP, 'registry-overwrite-cancel.json');
    const prior = {
      helm: {
        command: '/previous/node',
        args: ['/previous/helm/mcp/src/index.js'],
        env: { DASHBOARD_URL: 'http://127.0.0.1:7777' },
        tools: 112,
      },
    };
    fs.writeFileSync(stateFile, JSON.stringify(prior));

    const res = runInstaller(['--prefix', prefix, '--state-dir', stateDir], {
      mode: 'overwrite_cancel', stateFile,
    });

    assert.notEqual(res.status, 0, 'a cancelled replacement must fail the attempted integrated install');
    assert.doesNotMatch(res.stdout, /registered and verified/i,
      'a stale server must never satisfy replacement verification');
    assert.match(res.stdout + res.stderr, /registration did not complete|mcp add helm failed/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), prior,
      'cancelled replacement must preserve the prior working registration');
  });

  it('never hangs when the CLI prints the prompt and never responds, and reports failure truthfully', () => {
    const prefix = path.join(TMP, 'app-hang');
    const stateFile = path.join(TMP, 'registry-hang.json');
    const started = Date.now();
    const res = runInstaller(['--prefix', prefix], { mode: 'hang', stateFile, timeout: 45_000 });
    const elapsedMs = Date.now() - started;

    assert.notEqual(res.status, 0, 'an attempted but unverified Hermes registration must fail the installer');
    assert.ok(elapsedMs < 30_000, `installer must bound the hung hermes call, took ${elapsedMs}ms`);
    assert.doesNotMatch(res.stdout, /registered and verified/i, 'must not claim success on a hang');
    assert.match(res.stdout + res.stderr, /did not complete|timed out|failed/i);
    assert.match(res.stdout + res.stderr, /hermes mcp add helm/, 'must print manual retry instructions');
    assert.match(res.stdout + res.stderr, /hermes mcp test helm/, 'must print how to verify manually');
    assert.ok(fs.existsSync(path.join(prefix, 'mcp', 'src', 'index.js')),
      'the completed standalone install must remain available for the printed manual recovery command');
  });

  it('fails closed when `hermes mcp test` prints failure but misleadingly exits zero', () => {
    const prefix = path.join(TMP, 'app-test-fails');
    const stateFile = path.join(TMP, 'registry-test-fails.json');
    const res = runInstaller(['--prefix', prefix], { mode: 'test_fails', stateFile });

    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stdout, /registered and verified/i, 'must not claim success when verification fails');
    assert.match(res.stdout + res.stderr, /hermes mcp test helm.*failed|failed.*hermes mcp test helm/is);
  });

  it('rejects a successful connection that discovers zero tools', () => {
    const prefix = path.join(TMP, 'app-zero-tools');
    const stateFile = path.join(TMP, 'registry-zero-tools.json');
    const res = runInstaller(['--prefix', prefix], { mode: 'zero_tools', stateFile });

    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stdout, /registered and verified/i);
    assert.match(res.stdout + res.stderr, /Tools discovered:\s*0/);
    assert.match(res.stdout + res.stderr, /mcp test helm.*failed|failed.*mcp test helm/is);
  });

  for (const mode of ['test_fails', 'test_hang']) {
    it(`restores the exact prior Hermes config when post-save verification ${mode === 'test_hang' ? 'times out' : 'fails'}`, () => {
      const prefix = path.join(TMP, `app-restore-prior-${mode}`);
      const stateFile = path.join(TMP, `registry-restore-prior-${mode}.json`);
      const prior = {
        helm: {
          command: '/previous/node',
          args: ['/previous/helm/mcp/src/index.js'],
          env: { DASHBOARD_URL: 'http://127.0.0.1:7777', HELM_STATE_DIR: '/previous/state' },
          tools: 112,
        },
        unrelated: { command: '/keep/me', args: [], env: {}, tools: 3 },
      };
      const priorBytes = `${JSON.stringify(prior, null, 2)}\n`;
      fs.writeFileSync(stateFile, priorBytes, { mode: 0o600 });

      const res = runInstaller(['--prefix', prefix], {
        mode, stateFile, timeout: 30_000,
      });

      assert.notEqual(res.status, 0, 'failed post-save verification must fail the integrated install');
      assert.doesNotMatch(res.stdout, /registered and verified/i);
      assert.equal(fs.readFileSync(stateFile, 'utf8'), priorBytes,
        'post-save verification failure must restore the complete prior config byte-for-byte');
      assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600,
        'rollback must preserve the private config mode');
    });
  }

  it('does not remove a working prior registration before a replacement is verified', () => {
    const prefix = path.join(TMP, 'app-preserve-prior');
    const stateFile = path.join(TMP, 'registry-preserve-prior.json');
    const prior = {
      helm: {
        command: '/previous/node',
        args: ['/previous/helm/mcp/src/index.js'],
        env: { DASHBOARD_URL: 'http://127.0.0.1:7777' },
        tools: 112,
      },
    };
    fs.writeFileSync(stateFile, JSON.stringify(prior));

    const res = runInstaller(['--prefix', prefix], {
      mode: 'hang', stateFile, timeout: 45_000,
    });

    assert.notEqual(res.status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), prior,
      'a failed replacement must leave the prior Hermes registration intact');
  });

  it('tolerates a Hermes CLI that does not prompt for tool selection at all', () => {
    const prefix = path.join(TMP, 'app-no-prompt');
    const stateFile = path.join(TMP, 'registry-no-prompt.json');
    const res = runInstaller(['--prefix', prefix], { mode: 'no_prompt', stateFile });

    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /registered and verified/i);
  });

  it('uses a unique registration workspace when a killed legacy install left the old literal mktemp name behind', () => {
    const prefix = path.join(TMP, 'app-stale-mktemp-name');
    const stateFile = path.join(TMP, 'registry-stale-mktemp-name.json');
    const tempDir = path.join(TMP, 'stale-mktemp-name');
    fs.mkdirSync(tempDir);
    fs.writeFileSync(path.join(tempDir, 'helm-hermes-register.XXXXXX.mjs'), 'stale');

    const res = runInstaller(['--prefix', prefix], {
      mode: 'normal',
      stateFile,
      extraEnv: { TMPDIR: `${tempDir}/` },
    });

    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /registered and verified/i);
    assert.equal(fs.readFileSync(path.join(tempDir, 'helm-hermes-register.XXXXXX.mjs'), 'utf8'), 'stale');
  });

  it('fails noninteractively with manual guidance when the installed Hermes CLI lacks the required config-path support', () => {
    const prefix = path.join(TMP, 'app-unsupported-cli');
    const stateFile = path.join(TMP, 'registry-unsupported-cli.json');
    const res = runInstaller(['--prefix', prefix], {
      mode: 'config_path_unsupported', stateFile,
    });

    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stdout, /registered and verified/i);
    assert.match(res.stdout + res.stderr, /could not resolve the active Hermes config path|unsupported/i);
    assert.match(res.stdout + res.stderr, /hermes mcp add helm/);
    assert.match(res.stdout + res.stderr, /hermes mcp test helm/);
    assert.ok(fs.existsSync(path.join(prefix, 'mcp', 'src', 'index.js')));
  });

  it('never prints the dashboard token while registering with Hermes', () => {
    const prefix = path.join(TMP, 'app-token-safety');
    const stateFile = path.join(TMP, 'registry-token-safety.json');
    fs.mkdirSync(prefix, { recursive: true });
    const sentinel = 'sentinel-dashboard-token-must-not-leak';
    fs.writeFileSync(path.join(prefix, '.dashboard-token'), `${sentinel}\n`, { mode: 0o600 });

    const res = runInstaller(['--prefix', prefix, '--upgrade'], { mode: 'normal', stateFile });

    assert.ok(!res.stdout.includes(sentinel), 'stdout must never contain the dashboard token');
    assert.ok(!res.stderr.includes(sentinel), 'stderr must never contain the dashboard token');
  });

  it('only reaches the success summary after verified registration', () => {
    const prefixOk = path.join(TMP, 'app-summary-ok');
    const stateFileOk = path.join(TMP, 'registry-summary-ok.json');
    const ok = runInstaller(['--prefix', prefixOk], { mode: 'normal', stateFile: stateFileOk });
    assert.match(ok.stdout, /Hermes MCP:.*registered and verified/i);

    const prefixFail = path.join(TMP, 'app-summary-fail');
    const stateFileFail = path.join(TMP, 'registry-summary-fail.json');
    const fail = runInstaller(['--prefix', prefixFail], { mode: 'hang', stateFile: stateFileFail, timeout: 45_000 });
    assert.notEqual(fail.status, 0);
    assert.doesNotMatch(fail.stdout, /==> Done\.|Hermes MCP:.*registered and verified/i);
    assert.match(fail.stdout + fail.stderr, /registration did not complete/i);
  });
});

describe('install-helm.sh Hermes registration source', () => {
  it('never wires the dashboard token into the hermes CLI invocation', () => {
    const source = fs.readFileSync(path.join(ROOT, 'install-helm.sh'), 'utf8');
    const start = source.indexOf('Hermes MCP registration');
    assert.ok(start >= 0, 'expected a Hermes MCP registration section');
    const section = source.slice(start, source.indexOf('# ──', start + 40));
    assert.doesNotMatch(section, /DASHBOARD_TOKEN|dashboard-token/);
  });
});
