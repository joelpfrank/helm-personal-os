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

function runInstaller(args, { mode, stateFile, extraEnv = {}, timeout = 60_000 } = {}) {
  const env = {
    ...process.env,
    HELM_INSTALL_TEST_SKIP_BUILD: '1',
    PATH: `${FAKE_HERMES_DIR}:${process.env.PATH}`,
    FAKE_HERMES_MODE: mode || 'normal',
    FAKE_HERMES_STATE: stateFile,
    // Keep bounded-timeout tests fast without changing production defaults.
    HELM_HERMES_TIMEOUT_MS: '1500',
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
    assert.equal(registry.helm.command, process.execPath);
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

    assert.equal(res.status, 0, 'optional Hermes registration must not fail the Helm install');
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
    const res = runInstaller(['--prefix', prefix], { mode: 'hang', stateFile, timeout: 30_000 });
    const elapsedMs = Date.now() - started;

    assert.equal(res.status, 0, 'a failed Hermes registration must not fail the whole install');
    assert.ok(elapsedMs < 15_000, `installer must bound the hung hermes call, took ${elapsedMs}ms`);
    assert.doesNotMatch(res.stdout, /registered and verified/i, 'must not claim success on a hang');
    assert.match(res.stdout + res.stderr, /did not complete|timed out|failed/i);
    assert.match(res.stdout + res.stderr, /hermes mcp add helm/, 'must print manual retry instructions');
    assert.match(res.stdout + res.stderr, /hermes mcp test helm/, 'must print how to verify manually');
  });

  it('fails closed when `hermes mcp test` prints failure but misleadingly exits zero', () => {
    const prefix = path.join(TMP, 'app-test-fails');
    const stateFile = path.join(TMP, 'registry-test-fails.json');
    const res = runInstaller(['--prefix', prefix], { mode: 'test_fails', stateFile });

    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /registered and verified/i, 'must not claim success when verification fails');
    assert.match(res.stdout + res.stderr, /hermes mcp test helm.*failed|failed.*hermes mcp test helm/is);
  });

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
      mode: 'hang', stateFile, timeout: 30_000,
    });

    assert.equal(res.status, 0);
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

  it('the installer summary reports Hermes status truthfully instead of an unconditional claim', () => {
    const prefixOk = path.join(TMP, 'app-summary-ok');
    const stateFileOk = path.join(TMP, 'registry-summary-ok.json');
    const ok = runInstaller(['--prefix', prefixOk], { mode: 'normal', stateFile: stateFileOk });
    assert.match(ok.stdout, /Hermes MCP:.*registered and verified/i);

    const prefixFail = path.join(TMP, 'app-summary-fail');
    const stateFileFail = path.join(TMP, 'registry-summary-fail.json');
    const fail = runInstaller(['--prefix', prefixFail], { mode: 'hang', stateFile: stateFileFail, timeout: 30_000 });
    assert.match(fail.stdout, /Hermes MCP:.*did not complete/i);
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
