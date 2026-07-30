import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkCommitMetadata,
  findForbiddenPath,
  findSensitiveContent,
  isTextBuffer,
  pngPrivacyMetadataChunks,
  portableArchivePathAllowed,
  summarizeAudit,
} from '../scripts/check-public-safety.mjs';
import { findSecretContent } from '../scripts/scan-secrets.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

describe('canonical public release gate', () => {
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

  it('makes commit-header privacy part of the complete-history gate', () => {
    const safety = fs.readFileSync(path.join(ROOT, 'scripts/check-public-safety.mjs'), 'utf8');
    assert.match(safety, /checkCommitMetadata/);
    assert.match(safety, /commit metadata:/);
  });
});

describe('commit metadata privacy policy', () => {
  function commitFixture(email) {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-commit-metadata-'));
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: repository });
    fs.writeFileSync(path.join(repository, 'README.md'), 'public fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repository });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Public Maintainer',
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: 'Public Maintainer',
        GIT_COMMITTER_EMAIL: email,
      },
    });
    return repository;
  }

  it('accepts only the account-associated GitHub noreply identity across all refs', () => {
    const allowed = '33599724+' + 'joelpfrank' + '@users.noreply.github.com';
    const repository = commitFixture(allowed);
    try {
      execFileSync('git', ['branch', 'release-candidate'], { cwd: repository });
      execFileSync('git', ['tag', '-a', 'v0.1.0', '-m', 'fixture release'], {
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

  it('fails closed without reproducing a disallowed address in output', () => {
    const disallowed = 'private-owner' + '@real-domain.invalid';
    const repository = commitFixture(disallowed);
    try {
      assert.throws(
        () => checkCommitMetadata(repository),
        (error) => {
          assert.match(error.message, /commit metadata privacy scan failed/);
          assert.match(error.message, /author email is not the approved GitHub noreply identity/);
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
  it('rejects a tracked file reached through an ignored symlinked ancestor', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-public-safety-'));
    const repository = path.join(fixture, 'repository');
    const external = path.join(fixture, 'external');
    try {
      fs.mkdirSync(path.join(repository, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(repository, 'docs'), { recursive: true });
      fs.mkdirSync(external);
      fs.copyFileSync(
        path.join(ROOT, 'scripts/check-public-safety.mjs'),
        path.join(repository, 'scripts/check-public-safety.mjs'),
      );
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
    assert.equal(portableArchivePathAllowed('Helm/docs/MCP.md'), true);
    for (const member of [
      '../outside',
      'Helm/../../outside',
      '/absolute/path',
      'Other/server/src/index.js',
      'Helm/server/data/live.db',
      'Helm/.env.local',
      'Helm/mcp/README.md',
      'Helm/scripts/create-demo-workspace.mjs.evil',
    ]) {
      assert.equal(portableArchivePathAllowed(member), false, `${member} must be rejected`);
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
