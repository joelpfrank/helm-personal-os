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
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('maintainer documentation', () => {
  it('covers every section a maintainer has to act from, and stays linked', () => {
    const text = read('docs/MAINTAINERS.md');
    const missing = [
      ['canonical-upstream status', /canonical/i, /upstream/i],
      ['release procedure', /## Release procedure/i, /npm run check/],
      ['safe update strategy', /## Safe update strategy/i, /HELM_STATE_DIR/, /--upgrade/, /atomic/i],
      ['live migration', /## (Live )?[Mm]igration/i, /migrate-state\.mjs/, /--apply/,
        /copy-only|never (deletes|modifies)/i],
      ['rollback', /## Rollback/i],
      ['private-overlay boundary', /## Private[- ]overlay boundary/i, /export-public-source\.sh/],
      ['monthly checklist', /## Monthly checklist/i, /security:gitleaks/],
    ]
      .filter(([, ...patterns]) => patterns.some((pattern) => !pattern.test(text)))
      .map(([name]) => name);
    assert.deepEqual(missing, [], 'these maintainer sections are missing or incomplete');

    // Recovery must never be phrased as destruction of the source being
    // recovered from; that is the one instruction here that could lose data.
    assert.doesNotMatch(text, /rm -rf.*legacy/i, 'rollback must never instruct deleting the legacy source');
    assert.match(read('README.md'), /docs\/MAINTAINERS\.md/);
  });

  it('exposes convergence:verify and migrate:state wired to scripts that exist', () => {
    const scripts = JSON.parse(read('package.json')).scripts ?? {};
    for (const [name, command] of [
      ['convergence:verify', 'node scripts/verify-convergence.mjs'],
      ['migrate:state', 'node scripts/migrate-state.mjs'],
    ]) {
      assert.equal(scripts[name], command);
      // The documented entry point is only stable if the file behind it is
      // really there; a rename would otherwise fail for the maintainer, not here.
      assert.ok(fs.existsSync(path.join(ROOT, command.replace('node ', ''))),
        `${name} points at a missing script`);
    }
  });
});
