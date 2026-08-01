import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkCommitMetadata,
  checkHistory,
  checkTrackedSource,
  createFreshPublicHistory,
  findForbiddenPath,
  findSensitiveContent,
  isTextBuffer,
  pngPrivacyMetadataChunks,
  PORTABLE_EXCLUDED_FILES,
  portableArchivePathAllowed,
  summarizeAudit,
} from '../scripts/check-public-safety.mjs';
import { findSecretContent } from '../scripts/scan-secrets.mjs';
import { maintainerOnly } from '../scripts/lib/tree-context.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

describe('canonical public release gate', () => {
  it('builds the reviewed history from the exact portable export', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-fresh-public-history-'));
    const archiveRoot = path.join(fixture, 'archive');
    const archive = path.join(fixture, 'Helm-portable.zip');
    fs.mkdirSync(path.join(archiveRoot, 'Helm'), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, 'Helm/README.md'), 'public candidate\n');
    execFileSync('zip', ['-q', '-r', archive, 'Helm'], { cwd: archiveRoot });

    const fresh = createFreshPublicHistory(archive);
    try {
      assert.equal(
        execFileSync('git', ['ls-files'], { cwd: fresh.repository, encoding: 'utf8' }),
        'README.md\n',
      );
      assert.deepEqual(checkHistory(fresh.repository), { commits: 1, blobs: 1, treeEntries: 1 });
      assert.deepEqual(checkCommitMetadata(fresh.repository), { refs: 1, commits: 1, annotatedTags: 0 });
      assert.equal(
        execFileSync('git', ['log', '-1', '--format=%s'], { cwd: fresh.repository, encoding: 'utf8' }),
        'Helm v0 public source\n',
      );
    } finally {
      fresh.cleanup();
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('dates the fresh public commit at export time instead of pinning a fake epoch', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-fresh-public-date-'));
    const archiveRoot = path.join(fixture, 'archive');
    const archive = path.join(fixture, 'Helm-portable.zip');
    fs.mkdirSync(path.join(archiveRoot, 'Helm'), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, 'Helm/README.md'), 'public candidate\n');
    execFileSync('zip', ['-q', '-r', archive, 'Helm'], { cwd: archiveRoot });

    const before = Math.floor(Date.now() / 1000);
    const fresh = createFreshPublicHistory(archive);
    try {
      const after = Math.floor(Date.now() / 1000);
      const [authored, committed] = execFileSync(
        'git',
        ['log', '-1', '--format=%at%n%ct'],
        { cwd: fresh.repository, encoding: 'utf8' },
      ).trim().split('\n').map(Number);

      // A real export timestamp is what puts the commit on the maintainer's
      // contribution graph; a pinned epoch reads as scrubbed history.
      for (const [label, stamp] of [['author', authored], ['committer', committed]]) {
        assert.ok(
          stamp >= before && stamp <= after,
          `${label} date ${stamp} must fall inside the export window ${before}..${after}`,
        );
      }

      const safety = fs.readFileSync(path.join(ROOT, 'scripts/check-public-safety.mjs'), 'utf8');
      assert.doesNotMatch(safety, /GIT_(?:AUTHOR|COMMITTER)_DATE\s*:/);
    } finally {
      fresh.cleanup();
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('runs tests, production build, safety/package inspection, and production audit', () => {
    const check = readJson('package.json').scripts?.check ?? '';
    assert.match(check, /npm run test/);
    assert.match(check, /npm run build/);
    assert.match(check, /check-public-safety[.]mjs/);
    assert.match(check, /check-public-safety[.]mjs --history/);
    assert.match(check, /npm audit --omit=dev/);
  });

  it('exposes a complete-history independent secret scan', () => {
    const scripts = readJson('package.json').scripts ?? {};
    const scan = scripts['security:scan-history'] ?? '';
    assert.match(scan, /scan-secrets[.]mjs --history/);
    assert.match(scripts['security:gitleaks'] ?? '', /gitleaks git/);
    assert.match(fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8'), /complete fresh public Git history/i);
  });

  it('makes commit-header privacy part of the fresh-export history gate', () => {
    const safety = fs.readFileSync(path.join(ROOT, 'scripts/check-public-safety.mjs'), 'utf8');
    assert.match(safety, /checkCommitMetadata/);
    assert.match(safety, /fresh public export history:/);
  });
});

describe('commit metadata privacy policy', () => {
  function commitFixture(authorEmail, identities = {}) {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-commit-metadata-'));
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: repository });
    fs.writeFileSync(path.join(repository, 'README.md'), 'public fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repository });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: identities.authorName ?? 'Public Maintainer',
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: identities.committerName ?? 'Public Maintainer',
        GIT_COMMITTER_EMAIL: identities.committerEmail ?? authorEmail,
      },
    });
    return repository;
  }

  it('accepts only the account-associated GitHub noreply identity across all refs', () => {
    const allowed = '33599724+' + 'joelpfrank' + '@users.noreply.github.com';
    const repository = commitFixture(allowed);
    try {
      execFileSync('git', ['branch', 'release-candidate'], { cwd: repository });
      execFileSync('git', ['tag', '-a', 'v0', '-m', 'fixture release'], {
        cwd: repository,
        env: {
          ...process.env,
          GIT_COMMITTER_NAME: 'Public Maintainer',
          GIT_COMMITTER_EMAIL: allowed,
        },
      });
      assert.deepEqual(checkCommitMetadata(repository), { refs: 3, commits: 1, annotatedTags: 1 });
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });

  it('accepts official Dependabot commits without allowing arbitrary identities', () => {
    const dependabot = '49699333+' + 'dependabot[bot]' + '@users.noreply.github.com';
    const github = 'noreply' + '@github.com';
    const repository = commitFixture(dependabot, {
      authorName: 'dependabot[bot]',
      committerName: 'GitHub',
      committerEmail: github,
    });
    try {
      assert.deepEqual(checkCommitMetadata(repository), { refs: 1, commits: 1, annotatedTags: 0 });
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });

  it('rejects lookalike bot identities even when they use GitHub-owned email domains', () => {
    const dependabot = '49699333+' + 'dependabot[bot]' + '@users.noreply.github.com';
    const github = 'noreply' + '@github.com';
    const repository = commitFixture(dependabot, {
      authorName: 'Not Dependabot',
      committerName: 'GitHub',
      committerEmail: github,
    });
    try {
      assert.throws(() => checkCommitMetadata(repository), /author identity is not approved/);
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });

  it('fails closed without reproducing a disallowed address in output', () => {
    const disallowed = 'private-owner' + '@real-domain.invalid';
    const repository = commitFixture(disallowed);
    try {
      assert.throws(
        () => checkCommitMetadata(repository),
        (error) => {
          assert.match(error.message, /commit metadata privacy scan failed/);
          assert.match(error.message, /author identity is not approved/);
          assert.equal(error.message.includes(disallowed), false);
          return true;
        },
      );
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe('tracked-file safety policy', () => {
  it('scans internal Hermes control artifacts in the current candidate', () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-hermes-current-safety-'));
    try {
      fs.mkdirSync(path.join(repository, '.hermes/evidence'), { recursive: true });
      fs.writeFileSync(
        path.join(repository, '.hermes/evidence/private.md'),
        'machine path: /' + 'Users/private-owner/project\n',
      );
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: repository });
      execFileSync('git', ['add', '.'], { cwd: repository });

      assert.throws(
        () => checkTrackedSource(repository),
        /[.]hermes\/evidence\/private[.]md: macOS user path/,
      );
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });

  it('scans internal Hermes control artifacts across complete history', () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-hermes-history-safety-'));
    try {
      fs.mkdirSync(path.join(repository, '.hermes/evidence'), { recursive: true });
      fs.writeFileSync(
        path.join(repository, '.hermes/evidence/private.md'),
        'machine path: /' + 'Users/private-owner/project\n',
      );
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: repository });
      execFileSync('git', ['add', '.'], { cwd: repository });
      execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
        cwd: repository,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Public Maintainer',
          GIT_AUTHOR_EMAIL: '33599724+' + 'joelpfrank' + '@users.noreply.github.com',
          GIT_COMMITTER_NAME: 'Public Maintainer',
          GIT_COMMITTER_EMAIL: '33599724+' + 'joelpfrank' + '@users.noreply.github.com',
        },
      });

      assert.throws(
        () => checkHistory(repository),
        /[.]hermes\/evidence\/private[.]md: macOS user path/,
      );
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });

  it('rejects a tracked file reached through an ignored symlinked ancestor', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-public-safety-'));
    const repository = path.join(fixture, 'repository');
    const external = path.join(fixture, 'external');
    try {
      fs.mkdirSync(path.join(repository, 'scripts/lib'), { recursive: true });
      fs.mkdirSync(path.join(repository, 'docs'), { recursive: true });
      fs.mkdirSync(external);
      for (const relative of ['scripts/check-public-safety.mjs', 'scripts/lib/tree-context.mjs']) {
        fs.copyFileSync(path.join(ROOT, relative), path.join(repository, relative));
      }
      fs.writeFileSync(path.join(repository, 'docs/MCP.md'), 'tracked public documentation\n');
      execFileSync('git', ['init', '-q'], { cwd: repository });
      execFileSync('git', ['add', 'scripts/check-public-safety.mjs', 'docs/MCP.md'], { cwd: repository });

      fs.renameSync(path.join(repository, 'docs/MCP.md'), path.join(external, 'MCP.md'));
      fs.rmdirSync(path.join(repository, 'docs'));
      fs.symlinkSync(external, path.join(repository, 'docs'));
      fs.writeFileSync(path.join(repository, '.git/info/exclude'), 'docs\n');

      const result = spawnSync(process.execPath, ['scripts/check-public-safety.mjs'], {
        cwd: repository,
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /docs\/MCP[.]md: tracked path ancestor docs must be a real directory, not a symlink/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects private data, credential, backup, log, and environment paths', () => {
    for (const candidate of [
      'server/data/helm.db',
      'backups/helm.sqlite3',
      'logs/server.log',
      '.env',
      'server/src/.env.production',
      '.dashboard-token',
      'config/client-secret.pem',
      'private.sqlite-wal',
    ]) {
      assert.ok(findForbiddenPath(candidate), `${candidate} must be forbidden`);
    }
  });

  it('allows public templates and normal source paths', () => {
    for (const candidate of [
      '.env.example',
      'server/src/auth.js',
      'test/public-safety.test.mjs',
      'docs/DEVELOPMENT.md',
    ]) {
      assert.equal(findForbiddenPath(candidate), null, `${candidate} must be allowed`);
    }
  });

  it('rejects generic private identifiers and sender identifiers', () => {
    const canaries = [
      '/' + 'Users/' + 'private-owner/project',
      '/' + 'home/' + 'private-owner/project',
      '/' + 'opt/' + 'private/helm',
      'a@' + 'private.invalid',
      '+' + '447700900123',
      'private-host.lo' + 'cal',
    ];
    for (const canary of canaries) {
      assert.ok(findSensitiveContent(Buffer.from(canary)), `must detect ${canary}`);
    }
  });

  it('allows reserved synthetic email domains but rejects ordinary addresses', () => {
    for (const domain of ['example.com', 'example.invalid', 'example.test']) {
      assert.equal(findSensitiveContent(Buffer.from(`Use owner@${domain} in fixtures.`)), null);
    }
    assert.ok(findSensitiveContent(Buffer.from('Use owner@' + 'real-domain.test.invalid in fixtures.')));
  });

  it('does not decode arbitrary binary bytes as public text', () => {
    assert.equal(isTextBuffer(Buffer.from([0x00, 0x2f, 0x55, 0x73, 0x65, 0x72, 0x73, 0x2f])), false);
    assert.equal(isTextBuffer(Buffer.from([0xff, 0xfe, 0x2f, 0x68, 0x6f, 0x6d, 0x65, 0x2f])), false);
    assert.equal(isTextBuffer(Buffer.from('ordinary UTF-8 source ✓')), true);
  });

  it('rejects identifying PNG text and EXIF chunks', () => {
    const png = (...chunks) => Buffer.concat([
      Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
      ...chunks.map((type) => Buffer.concat([
        Buffer.alloc(4),
        Buffer.from(type, 'ascii'),
        Buffer.alloc(4),
      ])),
    ]);
    assert.deepEqual(pngPrivacyMetadataChunks(png('IHDR', 'IDAT', 'IEND')), []);
    assert.deepEqual(pngPrivacyMetadataChunks(png('IHDR', 'tEXt', 'eXIf', 'IEND')), ['eXIf', 'tEXt']);
  });
});

describe('independent high-signal secret detector', () => {
  it('detects known token families and private keys without fixture exemptions', () => {
    const canaries = [
      'gh' + 'p_' + 'A'.repeat(36),
      's' + 'k-ant-api03-' + 'B'.repeat(32),
      'AK' + 'IA' + 'C'.repeat(16),
      '-----BEGIN ' + 'PRIVATE KEY-----\nsynthetic\n',
      'client_' + 'secret = "' + 'D'.repeat(32) + '"',
    ];
    for (const canary of canaries) {
      assert.ok(findSecretContent(Buffer.from(canary)), 'synthetic credential must be detected');
    }
  });

  it('does not flag hashes, package integrity values, or documented variable names alone', () => {
    const safe = [
      'sha256=8150b9c487de93d78f7e74d2c6fd839e87026bf910850cba5733f70d5a5a7f1b',
      'integrity: sha512-' + 'A'.repeat(88),
      'Set ANTHROPIC_API_KEY in your environment.',
      'const tokenPath = process.env.HELM_TOKEN_PATH;',
    ];
    for (const value of safe) {
      assert.equal(findSecretContent(Buffer.from(value)), null, `must allow ${value}`);
    }
  });
});

describe('portable archive policy', () => {
  it('allows only a single Helm directory and rejects unsafe archive members', () => {
    assert.equal(portableArchivePathAllowed('Helm/server/src/index.js'), true);
    assert.equal(portableArchivePathAllowed('Helm/LICENSE'), true);
    assert.equal(portableArchivePathAllowed('Helm/README.md'), true);
    assert.equal(portableArchivePathAllowed('Helm/docs/MCP.md'), true);
    assert.equal(portableArchivePathAllowed('Helm/docs/assets/helm-today.png'), true);
    assert.equal(portableArchivePathAllowed('Helm/test/public-safety.test.mjs'), true);
    for (const member of [
      '../outside',
      'Helm/../../outside',
      '/absolute/path',
      'Other/server/src/index.js',
      'Helm/server/data/live.db',
      'Helm/.env.local',
      'Helm/mcp/README.md',
      'Helm/.hermes/private-plan.md',
      'Helm/private/untracked-file.txt',
    ]) {
      assert.equal(portableArchivePathAllowed(member), false, `${member} must be rejected`);
    }
  });

  it('keeps the launch media and its manifest local instead of publishing them', () => {
    assert.deepEqual([...PORTABLE_EXCLUDED_FILES].sort(), [
      'docs/LAUNCH-ASSETS.md',
      'docs/assets/helm-demo.mp4',
      'docs/assets/helm-linkedin-01-product.png',
      'docs/assets/helm-linkedin-02-architecture.png',
      'docs/assets/helm-linkedin-03-method.png',
    ]);
    for (const relative of PORTABLE_EXCLUDED_FILES) {
      assert.equal(
        portableArchivePathAllowed(`Helm/${relative}`),
        false,
        `${relative} is withheld from publication and must never appear in the archive`,
      );
      // Only the maintainer checkout holds the withheld media; a recipient's
      // tree legitimately lacks it, which is the point of withholding it.
      if (!maintainerOnly('the withheld-media presence check')) {
        assert.ok(
          fs.existsSync(path.join(ROOT, relative)),
          `${relative} must stay in the private working tree`,
        );
      }
    }
    // The screenshots and the architecture image are still part of the release.
    for (const published of [
      'docs/assets/helm-today.png',
      'docs/assets/helm-coach.png',
      'docs/assets/helm-tasks.png',
      'docs/assets/helm-habits-workouts.png',
      'docs/assets/helm-architecture.png',
      'docs/helm-architecture.html',
    ]) {
      assert.equal(portableArchivePathAllowed(`Helm/${published}`), true, `${published} must ship`);
    }
  });

  it('leaves no dead link to the excluded media in published documentation', () => {
    for (const relative of ['README.md', 'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md', 'docs/CASE-STUDY.md']) {
      const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      for (const excluded of PORTABLE_EXCLUDED_FILES) {
        const target = path.basename(excluded).replaceAll('.', '[.]');
        assert.doesNotMatch(
          text,
          new RegExp(`\\]\\([^)]*${target}\\)`),
          `${relative} must not link ${excluded}, which is excluded from the public export`,
        );
      }
    }
  });
});

describe('production dependency audit policy', () => {
  it('fails when critical or high findings remain and accepts lower severities', () => {
    assert.deepEqual(
      summarizeAudit({ metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 2, low: 1 } } }),
      { critical: 0, high: 0, moderate: 2, low: 1, acceptable: true },
    );
    assert.equal(
      summarizeAudit({ metadata: { vulnerabilities: { critical: 1, high: 0 } } }).acceptable,
      false,
    );
    assert.equal(
      summarizeAudit({ metadata: { vulnerabilities: { critical: 0, high: 1 } } }).acceptable,
      false,
    );
  });
});
