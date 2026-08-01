import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

// The launch identity is the plain label "v0". The 0.0.0 in package manifests is
// a placeholder that exists only because npm requires valid semver; it is not a
// version users are ever shown as the release name.
describe('v0 launch-candidate identity', () => {
  it('names the exact portable artifact consistently', () => {
    const expected = 'Helm-portable-v0.zip';
    for (const relative of [
      'scripts/package-helm.sh',
      'scripts/check-public-safety.mjs',
      'README.md',
      'INSTALL.md',
      '.github/workflows/ci.yml',
    ]) {
      assert.match(read(relative), new RegExp(expected.replaceAll('.', '[.]')),
        `${relative} must name the v0 artifact`);
    }
  });

  it('leaves no 0.1.x label on any surface a visitor or client can observe', () => {
    for (const relative of [
      'README.md',
      'CHANGELOG.md',
      'SECURITY.md',
      'INSTALL.md',
      'AGENT-INTEGRATIONS.md',
      'THIRD_PARTY_LICENSES.md',
      'docs/CASE-STUDY.md',
      'package.json',
      'server/src/routes/health.js',
      'mcp/src/http.js',
      'scripts/launch-assets.mjs',
      '.github/workflows/ci.yml',
    ]) {
      assert.doesNotMatch(read(relative), /0\.1\.[01]/,
        `${relative} must not carry a retired 0.1.x release label`);
    }
  });

  it('describes v0 as the released public identity', () => {
    const changelog = read('CHANGELOG.md');
    assert.match(changelog, /## \[v0\]/);
    assert.match(changelog, /first public release/i);
    assert.doesNotMatch(changelog, /releases\/tag\/v0\.1\.[01]/);
    assert.doesNotMatch(changelog, /has not been published/i);
    assert.match(read('docs/CASE-STUDY.md'), /local gates passed; published as v0/i);
    assert.doesNotMatch(read('docs/CASE-STUDY.md'),
      /520 automated tests|268 public-safety files|741 automated tests/i);
  });

  it('quotes acceptance evidence a recipient can reproduce from the archive', () => {
    const study = read('docs/CASE-STUDY.md');
    // A test count is only meaningful next to the tree it was measured in: the
    // recipient's differs from the maintainer's because the export withholds
    // files. Quoting one number without saying which tree produced it is how
    // the previous figure went stale unnoticed.
    const recipient = study.match(/(\d+) tests passing and (\d+) skipped/);
    const maintainer = study.match(/nothing skipped: (\d+) tests/);
    assert.ok(recipient, 'the case study must state the recipient pass and skip counts');
    assert.ok(maintainer, 'the case study must state the maintainer count it is compared against');
    assert.ok(Number(maintainer[1]) >= Number(recipient[1]),
      'the maintainer checkout cannot pass fewer tests than a recipient does');
    assert.ok(Number(recipient[2]) > 0, 'a recipient skips the withheld-file checks; claiming zero is false');
    assert.match(study, /npm ci && npm run check/);
    // The claim that a recipient can reproduce it only holds if the gate and
    // the suite are actually inside the archive they receive.
    const packager = read('scripts/package-helm.sh');
    assert.ok(packager.includes('package.json') && packager.includes('test/'),
      'the gate and its suite must be packaged for the reproduction claim to be true');
  });
});

describe('visitor-first portable source', () => {
  it('packages the README, visitor documentation, tests, and synthetic assets', () => {
    const packager = read('scripts/package-helm.sh');
    for (const required of [
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'docs/',
      'scripts/',
      'test/',
    ]) {
      assert.ok(packager.includes(required), `portable allow-list must include ${required}`);
    }
  });

  it('provides a five-minute setup and an honest Choose your AI matrix', () => {
    const readme = read('README.md');
    assert.match(readme, /five-minute Mac setup/i);
    assert.match(readme, /Choose your AI/i);
    for (const boundary of [
      /No AI/i,
      /Claude Code/i,
      /Anthropic API/i,
      /OpenAI API/i,
      /Gemini API/i,
      /OpenRouter/i,
      /Codex CLI/i,
      /Gemini CLI[^\n]*not supported/i,
      /external MCP host/i,
    ]) {
      assert.match(readme, boundary);
    }
  });

  it('documents state, backups, upgrades, credential deletion, and remote processing', () => {
    const install = read('INSTALL.md');
    for (const requirement of [
      /--state-dir/,
      /backup/i,
      /--upgrade/,
      /delete[^\n]*(credential|API key)|credential[^\n]*delet/i,
      /remote provider|leaves (the|your) Mac/i,
    ]) {
      assert.match(install, requirement);
    }
  });

  it('documents the provider-neutral gateway rather than the retired two-path adapter', () => {
    const architecture = read('docs/ARCHITECTURE.md');
    assert.match(architecture, /provider registry/i);
    assert.match(architecture, /write-only/i);
    assert.match(architecture, /Anthropic[\s\S]*OpenAI[\s\S]*(Google )?Gemini[\s\S]*OpenRouter/i);
    assert.doesNotMatch(architecture, /normalizes two Anthropic-backed paths/i);
  });
});