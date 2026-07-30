// Convergence verification (scripts/verify-convergence.mjs).
//
// The verifier must prove — inside disposable temp directories only — that
// this public source checkout can install and then upgrade an instance while
// every external state file survives byte-for-byte with its inode intact.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-convergence.mjs');

describe('verify-convergence.mjs', () => {
  it('is confined to disposable temp paths by construction', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(text, /mkdtemp/i, 'must build its sandbox with mkdtemp');
    assert.match(text, /tmpdir\(\)/, 'must anchor the sandbox under os.tmpdir()');
    assert.ok(!text.includes('$HOME/Helm'), 'must never reference the default live prefix');
  });

  it('passes end-to-end: install + upgrade with external state protected', () => {
    const env = { ...process.env };
    delete env.HELM_STATE_DIR;
    delete env.HELM_HOME;
    const res = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT, env, encoding: 'utf8', timeout: 300_000,
    });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /convergence: PASS/);
    const sandbox = res.stdout.match(/^sandbox: (.+)$/m);
    assert.ok(sandbox, 'output must name its sandbox directory');
    assert.ok(sandbox[1].startsWith(fs.realpathSync(os.tmpdir())),
      'sandbox must live under os.tmpdir()');
    assert.ok(!fs.existsSync(sandbox[1]), 'sandbox must be cleaned up on success');
  });
});
