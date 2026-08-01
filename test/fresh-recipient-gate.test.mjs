import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  REPO_ROOT,
  isGitWorkingTree,
  isMaintainerCheckout,
  gitOnly,
  maintainerOnly,
} from '../scripts/lib/tree-context.mjs';

const TEST_DIR = path.resolve(import.meta.dirname);

// Helm hands its own gate to every recipient, so the gate has to survive being
// run somewhere other than the maintainer checkout: an unpacked
// Helm-portable-v0.zip has no Git tree at all, and a clone of the published
// repository has Git but none of the maintainer-only files. Neither recipient
// may be failed on files they were never sent.
function stageArchiveLikeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-recipient-tree-'));
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  for (const file of ['package.json', 'CHANGELOG.md']) {
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(dir, file));
  }
  return dir;
}

function runGate(dir, script, args = []) {
  const result = { status: 0, output: '' };
  try {
    result.output = execFileSync('node', [path.join(dir, 'scripts', script), ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    result.status = error.status ?? 1;
    result.output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  return result;
}

describe('tree context', () => {
  // Every skip in the suite keys off these predicates, so the maintainer
  // checkout has to keep answering true or the maintainer gate would quietly
  // skip its own strictest checks instead of failing. A recipient's copy is
  // legitimately neither, which is what the two cases below cover.
  it('skips nothing in the maintainer checkout', {
    skip: maintainerOnly('the maintainer-checkout invariant'),
  }, () => {
    assert.equal(isGitWorkingTree(REPO_ROOT), true, 'the maintainer checkout must be Git-backed');
    assert.equal(gitOnly('anything'), false);
    assert.equal(maintainerOnly('anything'), false);
  });

  it('reports an unpacked archive as neither Git-backed nor maintainer-owned', () => {
    const dir = stageArchiveLikeTree();
    try {
      assert.equal(isGitWorkingTree(dir), false);
      assert.equal(isMaintainerCheckout(dir), false);
      assert.match(gitOnly('the history scan', dir), /Git/);
      assert.match(maintainerOnly('the evidence check', dir), /maintainer/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a public clone as Git-backed but not maintainer-owned', () => {
    const dir = stageArchiveLikeTree();
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      assert.equal(isGitWorkingTree(dir), true);
      assert.equal(isMaintainerCheckout(dir), false);
      assert.equal(gitOnly('the history scan', dir), false);
      assert.match(maintainerOnly('the evidence check', dir), /maintainer/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('recipient-runnable release gate', () => {
  it('scans the working tree without a Git index instead of failing the recipient', () => {
    const dir = stageArchiveLikeTree();
    try {
      const result = runGate(dir, 'check-public-safety.mjs');
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /candidate files scanned/);
      assert.doesNotMatch(result.output, /not a git repository/i);
      // The portable rebuild reads the Git index, so it must announce the skip
      // rather than silently reporting a pass it never performed.
      assert.match(result.output, /portable package.*skipped/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the Git-only history reconstruction outside a Git checkout', () => {
    const dir = stageArchiveLikeTree();
    try {
      const result = runGate(dir, 'check-public-safety.mjs', ['--history']);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /skipped/i);
      assert.doesNotMatch(result.output, /not a git repository/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scans for secrets without a Git index instead of failing the recipient', () => {
    const dir = stageArchiveLikeTree();
    try {
      const result = runGate(dir, 'scan-secrets.mjs');
      assert.equal(result.status, 0, result.output);
      assert.doesNotMatch(result.output, /not a git repository/i);
      assert.match(result.output, /secret scan/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reports a planted secret in an archive-like tree', () => {
    const dir = stageArchiveLikeTree();
    try {
      fs.writeFileSync(path.join(dir, 'leak.txt'), `sk-ant-api03-${'A'.repeat(95)}\n`);
      const secrets = runGate(dir, 'scan-secrets.mjs');
      assert.equal(secrets.status, 1, secrets.output);
      assert.match(secrets.output, /leak\.txt/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reports a forbidden path in an archive-like tree', () => {
    const dir = stageArchiveLikeTree();
    try {
      fs.writeFileSync(path.join(dir, 'helm.sqlite3'), 'x');
      const safety = runGate(dir, 'check-public-safety.mjs');
      assert.equal(safety.status, 1, safety.output);
      assert.match(safety.output, /helm\.sqlite3/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('maintainer-only assertions carry a recipient skip', () => {
  // The published archive withholds .hermes build control, the development
  // start/stop helpers, and the local-only demo media plus the manifest that
  // describes it. A test that reads one of
  // those without a guard passes here and fails for every recipient, which is
  // exactly the failure this suite exists to prevent.
  // Reads of a maintainer-only path, not mentions of one: several suites build
  // synthetic .hermes fixtures inside a temporary tree, which is fine anywhere.
  const MAINTAINER_ONLY = [
    /(?:read|import|readFileSync)\(\s*(['"`])(?:\.\.\/)?\.hermes\//,
    /(['"`])(?:start|stop)\.sh\1/,
    /LAUNCH-ASSETS\.md/,
  ];

  it('guards every test that reads a maintainer-only path', () => {
    const offenders = [];
    for (const file of fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.mjs'))) {
      const source = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
      if (!MAINTAINER_ONLY.some((pattern) => pattern.test(source))) continue;
      if (!source.includes('maintainerOnly')) offenders.push(file);
    }
    assert.deepEqual(offenders, [], 'these tests read maintainer-only paths without a recipient skip');
  });
});
