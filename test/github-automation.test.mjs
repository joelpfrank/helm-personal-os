// TDD tests: GitHub automation (CI, CodeQL, Dependabot) is present and safe.
// RED first — the workflows must FAIL these before being written.
//
// These are structural tests: the YAML is PARSED (npm `yaml` dev dependency)
// and asserted on semantically, not string-matched, so a reordered key or a
// renamed job cannot silently satisfy a check it does not actually meet.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readYaml(relativePath) {
  return parse(readText(relativePath));
}

// All steps across all jobs of a parsed workflow.
function allSteps(workflow) {
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

function allUses(workflow) {
  return allSteps(workflow).map((s) => s.uses).filter(Boolean);
}

function allRunScripts(workflow) {
  return allSteps(workflow).map((s) => s.run).filter(Boolean);
}

// uses ref pinned to an immutable full commit SHA: owner/repo[/path]@<40 hex>
const SHA_PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

describe('CI workflow (.github/workflows/ci.yml)', () => {
  const wf = readYaml('.github/workflows/ci.yml');
  const raw = readText('.github/workflows/ci.yml');

  it('triggers on pull_request and on push to main only', () => {
    assert.ok(wf.on, 'workflow must declare triggers');
    assert.ok('pull_request' in wf.on, 'must run on pull_request');
    assert.deepEqual(wf.on.push?.branches, ['main'], 'push trigger must be limited to main');
    assert.ok(!('schedule' in wf.on), 'CI has no schedule trigger');
  });

  it('declares least-privilege workflow permissions (contents: read only)', () => {
    assert.deepEqual(wf.permissions, { contents: 'read' });
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (job.permissions !== undefined) {
        assert.deepEqual(job.permissions, { contents: 'read' },
          `job ${name} must not escalate beyond contents: read`);
      }
    }
  });

  it('runs npm ci and the canonical npm run check on Node 20', () => {
    const setupNode = allSteps(wf).find((s) => s.uses?.startsWith('actions/setup-node@'));
    assert.ok(setupNode, 'must use actions/setup-node');
    assert.equal(String(setupNode.with?.['node-version']), '20');
    const runs = allRunScripts(wf);
    assert.ok(runs.some((r) => /(^|\s)npm ci(\s|$)/.test(r)), 'must install with npm ci');
    assert.ok(runs.some((r) => /(^|\s)npm run check(\s|$)/.test(r)), 'must run the canonical npm run check');
  });

  it('runs gitleaks over the full git history with a checksum-verified pinned binary', () => {
    const gitleaksJob = Object.values(wf.jobs).find((job) =>
      (job.steps ?? []).some((s) => s.run?.includes('gitleaks')));
    assert.ok(gitleaksJob, 'a job must run gitleaks');
    const checkout = gitleaksJob.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout?.with?.['fetch-depth'], 0,
      'gitleaks checkout must fetch full history (fetch-depth: 0)');
    const script = gitleaksJob.steps.map((s) => s.run ?? '').join('\n');
    assert.match(script, /gitleaks git/, 'must run the full-history git scan mode');
    assert.match(script, /\b[0-9a-f]{64}\b/, 'binary download must be pinned to a sha256 checksum');
    assert.match(script, /sha256sum -c|shasum -a 256 -c/, 'checksum must actually be verified');
  });

  it('every checkout fetches full history so history scanning cannot silently degrade', () => {
    for (const step of allSteps(wf)) {
      if (!step.uses?.startsWith('actions/checkout@')) continue;
      assert.equal(step.with?.['fetch-depth'], 0, 'checkout must set fetch-depth: 0');
    }
  });

  it('pins every action to an immutable full commit SHA with a version comment', () => {
    const uses = allUses(wf);
    assert.ok(uses.length > 0, 'workflow must use at least one action');
    for (const ref of uses) {
      assert.match(ref, SHA_PINNED, `${ref} must be pinned to a 40-hex commit SHA`);
      const line = raw.split('\n').find((l) => l.includes(ref));
      assert.match(line, /#\s*v\d/, `${ref} must carry a human-readable version comment`);
    }
  });

  it('makes no provider calls and requires no Anthropic/Claude credentials', () => {
    assert.doesNotMatch(raw, /anthropic/i);
    assert.doesNotMatch(raw, /claude/i);
    assert.doesNotMatch(raw, /api[_-]?key/i);
  });

  it('uploads no artifacts (nothing to gate behind v* tags)', () => {
    assert.ok(!allUses(wf).some((u) => u.includes('upload-artifact')),
      'CI must not upload artifacts; releases are cut manually from the gate output');
  });
});

describe('CodeQL workflow (.github/workflows/codeql.yml)', () => {
  const wf = readYaml('.github/workflows/codeql.yml');
  const raw = readText('.github/workflows/codeql.yml');

  it('covers pushes to main, pull requests, and a weekly schedule', () => {
    assert.deepEqual(wf.on.push?.branches, ['main']);
    assert.ok('pull_request' in wf.on, 'must run on pull_request');
    const crons = (wf.on.schedule ?? []).map((s) => s.cron);
    assert.equal(crons.length, 1, 'exactly one schedule entry');
    // weekly = a fixed day-of-week, not daily/monthly
    assert.match(crons[0], /^\d{1,2} \d{1,2} \* \* \d$/, 'cron must be a weekly schedule');
  });

  it('grants security-events: write only at the job level, contents: read elsewhere', () => {
    assert.deepEqual(wf.permissions, { contents: 'read' }, 'workflow default stays read-only');
    const jobs = Object.values(wf.jobs);
    assert.equal(jobs.length, 1, 'single analyze job');
    assert.deepEqual(jobs[0].permissions, {
      'contents': 'read',
      'security-events': 'write',
    });
  });

  it('analyzes JavaScript/TypeScript with an explicit no-build mode', () => {
    const init = allSteps(wf).find((s) => s.uses?.startsWith('github/codeql-action/init@'));
    assert.ok(init, 'must run codeql-action/init');
    assert.equal(init.with?.languages, 'javascript-typescript');
    assert.equal(init.with?.['build-mode'], 'none',
      'build must be explicit "none" — never autobuild through npm scripts');
    assert.ok(allSteps(wf).some((s) => s.uses?.startsWith('github/codeql-action/analyze@')),
      'must run codeql-action/analyze');
  });

  it('pins every action to an immutable full commit SHA with a version comment', () => {
    for (const ref of allUses(wf)) {
      assert.match(ref, SHA_PINNED, `${ref} must be pinned to a 40-hex commit SHA`);
      const line = raw.split('\n').find((l) => l.includes(ref));
      assert.match(line, /#\s*v\d/, `${ref} must carry a human-readable version comment`);
    }
  });

  it('requires no Anthropic/Claude credentials', () => {
    assert.doesNotMatch(raw, /anthropic/i);
    assert.doesNotMatch(raw, /api[_-]?key/i);
  });
});

describe('Dependabot (.github/dependabot.yml)', () => {
  const config = readYaml('.github/dependabot.yml');

  it('keeps weekly npm updates', () => {
    const npm = config.updates.find((u) => u['package-ecosystem'] === 'npm');
    assert.ok(npm, 'npm ecosystem must be configured');
    assert.equal(npm.schedule?.interval, 'weekly');
    assert.ok(npm['open-pull-requests-limit'] <= 10, 'PR limit stays modest');
  });

  it('adds weekly github-actions updates', () => {
    const actions = config.updates.find((u) => u['package-ecosystem'] === 'github-actions');
    assert.ok(actions, 'github-actions ecosystem must be configured');
    assert.equal(actions.schedule?.interval, 'weekly');
    assert.ok(actions['open-pull-requests-limit'] <= 10, 'PR limit stays modest');
  });
});

describe('YAML tooling stays out of production dependencies', () => {
  it('yaml is a root devDependency only', () => {
    const pkg = JSON.parse(readText('package.json'));
    assert.ok(pkg.devDependencies?.yaml, 'yaml must be declared as a devDependency');
    assert.ok(!pkg.dependencies?.yaml, 'yaml must not be a production dependency');
  });
});
