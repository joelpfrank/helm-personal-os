#!/usr/bin/env node
// Deterministic, read-only convergence verification.
//
// Proves — entirely inside a disposable mkdtemp sandbox under os.tmpdir(),
// never against a live install — that THIS public source checkout's
// installer can bring up a fresh instance and then upgrade it in place while
// every external HELM_STATE_DIR file survives byte-for-byte with its
// original inode untouched. The prefix's own code file is expected to get a
// fresh inode on upgrade (proof the atomic swap actually re-laid code);
// external state must not.
//
// This script never writes to the real project tree: --prefix and
// --state-dir are always fresh directories under the sandbox, and the
// sandbox is removed on both success and failure.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = path.join(ROOT, 'install-helm.sh');
const CODE_PROBE = path.join('server', 'src', 'index.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(file) {
  return { sha: sha256(file), ino: fs.statSync(file).ino };
}

function runInstaller(prefix, stateDir, extraArgs) {
  const env = { ...process.env, HELM_INSTALL_TEST_SKIP_BUILD: '1' };
  delete env.HELM_HOME;
  delete env.HELM_PORT;
  delete env.HELM_STATE_DIR;
  return spawnSync(
    'bash',
    [INSTALLER, '--prefix', prefix, '--state-dir', stateDir, '--no-launchagent', '--no-hermes', ...extraArgs],
    { env, encoding: 'utf8', timeout: 150_000 },
  );
}

const STATE_SEEDS = {
  'data/dashboard.db': 'sentinel-db-bytes\n',
  '.dashboard-token': 'sentinel-token-bytes\n',
  '.dashboard-password': '{"algo":"scrypt","sentinel":true}\n',
  '.mcp-http-token': 'sentinel-mcp-token-bytes\n',
  '.google-credentials.json': '{"client_id":"sentinel"}\n',
  '.anthropic-key': 'sentinel-key-bytes\n',
};

function main() {
  // realpathSync: macOS resolves /tmp and /var through symlinks (e.g. into
  // /private/var/...); normalize immediately so every downstream path and the
  // printed sandbox line consistently sit under the resolved temp root.
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'helm-convergence-')));
  let failure = null;
  try {
    const prefix = path.join(sandbox, 'app');
    const stateDir = path.join(sandbox, 'state');

    const fresh = runInstaller(prefix, stateDir, []);
    if (fresh.status !== 0) {
      throw new Error(`fresh install failed:\n${fresh.stdout}\n${fresh.stderr}`);
    }

    const before = {};
    for (const [rel, content] of Object.entries(STATE_SEEDS)) {
      const abs = path.join(stateDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
      fs.writeFileSync(abs, content, { mode: 0o600 });
      before[rel] = snapshot(abs);
    }
    const codeBefore = snapshot(path.join(prefix, CODE_PROBE));

    const upgrade = runInstaller(prefix, stateDir, ['--upgrade']);
    if (upgrade.status !== 0) {
      throw new Error(`upgrade failed:\n${upgrade.stdout}\n${upgrade.stderr}`);
    }

    const codeAfter = snapshot(path.join(prefix, CODE_PROBE));
    if (codeAfter.ino === codeBefore.ino) {
      throw new Error('upgrade did not re-lay code (prefix code file inode unchanged)');
    }

    for (const rel of Object.keys(STATE_SEEDS)) {
      const abs = path.join(stateDir, rel);
      const after = snapshot(abs);
      if (after.sha !== before[rel].sha) throw new Error(`${rel}: bytes changed across upgrade`);
      if (after.ino !== before[rel].ino) throw new Error(`${rel}: inode changed across upgrade (rewritten, not preserved)`);
    }

    console.log('convergence: PASS');
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    console.log(`sandbox: ${sandbox}`);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  if (failure) {
    console.error(`convergence: FAIL - ${failure}`);
    process.exit(1);
  }
}

main();
