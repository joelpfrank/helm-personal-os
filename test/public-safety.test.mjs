import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  findForbiddenPath,
  findSensitiveContent,
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
    assert.match(check, /npm audit --omit=dev/);
  });

  it('exposes a complete-history independent secret scan', () => {
    const scripts = readJson('package.json').scripts ?? {};
    const scan = scripts['security:scan-history'] ?? '';
    assert.match(scan, /scan-secrets[.]mjs --history/);
    assert.match(scripts['security:gitleaks'] ?? '', /gitleaks git/);
    assert.match(fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8'), /complete fresh public Git history/i);
  });
});

describe('tracked-file safety policy', () => {
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
      'a@' + 'example.invalid',
      '+' + '447700900123',
      'private-host.lo' + 'cal',
    ];
    for (const canary of canaries) {
      assert.ok(findSensitiveContent(Buffer.from(canary)), `must detect ${canary}`);
    }
  });

  it('allows only the documented synthetic email placeholder', () => {
    assert.equal(findSensitiveContent(Buffer.from('Use test@' + 'example.com in fixtures.')), null);
    assert.ok(findSensitiveContent(Buffer.from('Use owner@' + 'example.com in fixtures.')));
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
