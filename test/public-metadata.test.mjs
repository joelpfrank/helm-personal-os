import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const APPROVED_DESCRIPTION =
  'Local-first personal operating system with goal-aligned tasks, habits, health tracking, check-ins, and evidence-grounded AI coaching.';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('public package metadata', () => {
  const pkg = readJson('package.json');

  it('uses the canonical root name', () => {
    assert.equal(pkg.name, 'helm-personal-os');
  });

  it('is marked private', () => {
    assert.equal(pkg.private, true);
  });

  it('carries the approved public description', () => {
    assert.equal(pkg.description, APPROVED_DESCRIPTION);
  });

  it('declares the MIT license', () => {
    assert.equal(pkg.license, 'MIT');
  });

  it('requires Node >=20', () => {
    assert.equal(pkg.engines?.node, '>=20');
  });

  it('exposes the required root scripts', () => {
    assert.equal(pkg.scripts?.test, 'node --test test/*.test.mjs');
    assert.ok(pkg.scripts?.build, 'scripts.build must be defined');
    assert.ok(pkg.scripts?.check, 'scripts.check must be defined');
    assert.equal(pkg.scripts?.['package:portable'], 'bash scripts/package-helm.sh');
  });

  it('does not run the public-export safety test twice inside check', () => {
    // test/*.test.mjs already includes public-export.test.mjs, so check must
    // not invoke it a second time.
    const check = pkg.scripts?.check ?? '';
    assert.doesNotMatch(check, /public-export\.test\.mjs/);
  });
});

describe('workspace package Helm-safe names', () => {
  it('renames the server workspace package', () => {
    const pkg = readJson('server/package.json');
    assert.equal(pkg.name, 'helm-personal-os-server');
    assert.equal(pkg.license, 'MIT');
  });

  it('renames the web workspace package', () => {
    const pkg = readJson('web/package.json');
    assert.equal(pkg.name, 'helm-personal-os-web');
    assert.equal(pkg.license, 'MIT');
  });

  it('renames the mcp workspace package', () => {
    const pkg = readJson('mcp/package.json');
    assert.equal(pkg.name, 'helm-personal-os-mcp');
    assert.equal(pkg.license, 'MIT');
  });
});

describe('lockfile and public governance metadata', () => {
  it('keeps root and workspace names consistent in package-lock.json', () => {
    const lock = readJson('package-lock.json');
    assert.equal(lock.name, 'helm-personal-os');
    assert.equal(lock.packages?.['']?.name, 'helm-personal-os');
    assert.equal(lock.packages?.server?.name, 'helm-personal-os-server');
    assert.equal(lock.packages?.web?.name, 'helm-personal-os-web');
    assert.equal(lock.packages?.mcp?.name, 'helm-personal-os-mcp');
  });

  it('ships the required governance and privacy files', () => {
    const required = [
      'LICENSE',
      'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md',
      'SECURITY.md',
      'PRIVACY.md',
      'THIRD_PARTY_LICENSES.md',
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/pull_request_template.md',
      '.github/dependabot.yml',
    ];
    for (const file of required) {
      assert.ok(fs.statSync(path.join(ROOT, file)).isFile(), `${file} must exist`);
    }
    assert.match(
      readText('LICENSE'),
      new RegExp('^Copyright \\(c\\) 2026 Jo' + 'el Frank$', 'm'),
    );
  });

  it('documents external AI transmission and the proprietary SDK boundary', () => {
    const privacy = readText('PRIVACY.md');
    const licenses = readText('THIRD_PARTY_LICENSES.md');
    assert.match(privacy, /Anthropic/i);
    assert.match(privacy, /transmit|sent to/i);
    assert.doesNotMatch(privacy, /zero external data transmission/i);
    assert.match(licenses, /not an open-source license/i);
    assert.match(licenses, /MIT applies to Helm-authored source/i);
  });

  it('provides actionable contribution and private-reporting governance', () => {
    const contributing = readText('CONTRIBUTING.md');
    const security = readText('SECURITY.md');
    const conduct = readText('CODE_OF_CONDUCT.md');
    assert.match(contributing, /Node(?:\.js)?\s+20\+/i);
    assert.match(contributing, /synthetic/i);
    assert.match(security, /private vulnerability reporting/i);
    assert.doesNotMatch(security, /private GitHub message/i);
    assert.match(conduct, /private vulnerability reporting/i);
    assert.doesNotMatch(conduct, /direct message/i);
  });

  it('keeps license and provider notices in the portable distribution', () => {
    const packaging = readText('scripts/package-helm.sh');
    assert.match(packaging, /LICENSE/);
    assert.match(packaging, /THIRD_PARTY_LICENSES\\?\.md/);
    assert.match(packaging, /PRIVACY\\?\.md/);
  });
});

describe('stale dashboard/Trello branding is absent from visible metadata', () => {
  const STALE = /\b(dashboard|trello)\b/i;

  it('root package.json manifest has no stale branding', () => {
    const raw = readText('package.json');
    assert.doesNotMatch(raw, STALE);
  });

  it('server package.json manifest has no stale branding', () => {
    assert.doesNotMatch(readText('server/package.json'), STALE);
  });

  it('web package.json manifest has no stale branding', () => {
    assert.doesNotMatch(readText('web/package.json'), STALE);
  });

  it('mcp package.json manifest has no stale branding', () => {
    assert.doesNotMatch(readText('mcp/package.json'), STALE);
  });

  it('mcp stdio service metadata is renamed and carries no stale service name', () => {
    const source = readText('mcp/src/index.js');
    assert.match(source, /name:\s*'helm-personal-os-mcp'/);
    assert.match(source, /\[helm-personal-os-mcp\]/);
    assert.doesNotMatch(source, /dashboard-mcp/);
  });

  it('mcp http service and /health metadata is renamed and carries no stale service name', () => {
    const source = readText('mcp/src/http.js');
    assert.match(source, /service:\s*'helm-personal-os-mcp-http'/);
    assert.match(source, /name:\s*'helm-personal-os-mcp'/);
    assert.match(source, /\[helm-personal-os-mcp-http\]/);
    assert.doesNotMatch(source, /dashboard-mcp/);
    // Compatibility-sensitive token filename must be preserved verbatim,
    // not renamed as part of the branding sweep.
    assert.match(source, /\.dashboard-token/);
  });

  it('calendar OAuth auth page title has no stale branding', () => {
    const source = readText('server/src/routes/calendar.js');
    assert.doesNotMatch(source, /<title>Dashboard Calendar Auth<\/title>/);
    assert.match(source, /<title>Helm Calendar Auth<\/title>/);
    assert.doesNotMatch(source, />Dashboard\s*↔\s*Google Calendar</);
    assert.match(source, />Helm\s*↔\s*Google Calendar</);
  });

  it('PWA manifest naming has no stale branding', () => {
    const manifest = readJson('web/public/manifest.webmanifest');
    assert.doesNotMatch(manifest.name, STALE);
    assert.doesNotMatch(manifest.short_name, STALE);
  });

  it('installed in-app Coach MCP metadata has no stale branding', () => {
    const source = readText('server/src/lib/llm.js');
    assert.doesNotMatch(source, /dashboard/i);
  });

  it('server startup and health metadata use the public product identity', () => {
    const startup = readText('server/src/index.js');
    const health = readText('server/src/routes/health.js');
    assert.match(startup, /\[startup\] Helm Personal OS listening/);
    assert.doesNotMatch(startup, /\[startup\] dashboard listening/i);
    assert.match(health, /service:\s*'helm-personal-os'/);
  });

  it('the runtime-generated PWA manifest uses the full public product name', () => {
    const source = readText('server/src/app.js');
    assert.match(source, /name:\s*'Helm Personal OS'/);
    assert.match(source, /short_name:\s*'Helm'/);
  });

  it('removes stale branding from user-visible copy, coach instructions, and MCP tool descriptions', () => {
    const visibleSources = [
      'web/src/lib/i18n.js',
      'web/src/components/chat/ChatTranscript.jsx',
      'server/src/routes/chat.js',
      'mcp/src/tools.js',
    ];
    for (const relativePath of visibleSources) {
      assert.doesNotMatch(
        readText(relativePath),
        STALE,
        `${relativePath} must not expose stale dashboard/Trello branding`,
      );
    }
  });
});
