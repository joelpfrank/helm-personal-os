// Maintainer documentation and deterministic release/migration scripts.
//
// docs/MAINTAINERS.md is the maintainer-facing companion to SECURITY.md's
// release-check section: it must state this repository's canonical-upstream
// status, the release procedure, the safe (state-dir-based) update strategy,
// the copy-only live migration path with its exact rollback, the boundary
// between this public repo and any private working overlay, and a recurring
// monthly checklist. package.json must expose deterministic npm entry points
// for the convergence verifier and the state migrator so maintainers never
// have to remember raw `node scripts/...` invocations.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

describe('docs/MAINTAINERS.md', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'MAINTAINERS.md'), 'utf8');

  it('declares this repository as the canonical public upstream', () => {
    assert.match(text, /canonical/i);
    assert.match(text, /upstream/i);
  });

  it('documents a release procedure that points at the canonical local gate', () => {
    assert.match(text, /## Release procedure/i);
    assert.match(text, /npm run check/);
  });

  it('documents a safe update strategy grounded in the state-dir contract', () => {
    assert.match(text, /## Safe update strategy/i);
    assert.match(text, /HELM_STATE_DIR/);
    assert.match(text, /--upgrade/);
    assert.match(text, /atomic/i);
  });

  it('documents copy-only live migration with an exact rollback', () => {
    assert.match(text, /## (Live )?[Mm]igration/i);
    assert.match(text, /migrate-state\.mjs/);
    assert.match(text, /--apply/);
    assert.match(text, /copy-only|never (deletes|modifies)/i);
    assert.match(text, /## Rollback/i);
    assert.ok(!/rm -rf.*legacy/i.test(text), 'rollback must never instruct deleting the legacy source');
  });

  it('documents the private-overlay boundary', () => {
    assert.match(text, /## Private[- ]overlay boundary/i);
    assert.match(text, /export-public-source\.sh/);
  });

  it('documents a recurring monthly checklist', () => {
    assert.match(text, /## Monthly checklist/i);
    assert.match(text, /security:gitleaks/);
  });
});

describe('deterministic convergence/migration npm scripts', () => {
  it('exposes convergence:verify and migrate:state wired to the real scripts', () => {
    const scripts = readJson('package.json').scripts ?? {};
    assert.equal(scripts['convergence:verify'], 'node scripts/verify-convergence.mjs');
    assert.equal(scripts['migrate:state'], 'node scripts/migrate-state.mjs');
  });
});

describe('README links to maintainer documentation', () => {
  it('lists docs/MAINTAINERS.md alongside the other documentation entries', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /docs\/MAINTAINERS\.md/);
  });
});
