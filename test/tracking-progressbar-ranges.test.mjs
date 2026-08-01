import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { progressbarRange } from '../web/src/lib/progressbarRange.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('tracking progressbar ARIA ranges', () => {
  it('returns a finite internally valid range for a normal target', () => {
    assert.deepEqual(progressbarRange(37, 100), {
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 37,
    });
  });

  it('does not claim progressbar semantics for a zero total or target', () => {
    assert.equal(progressbarRange(0, 0), null);
  });

  it('does not claim progressbar semantics when a total or target is absent', () => {
    assert.equal(progressbarRange(12, undefined), null);
    assert.equal(progressbarRange(12, null), null);
  });

  it('sanitizes non-finite and out-of-range values before exposing ARIA', () => {
    assert.deepEqual(progressbarRange(Infinity, 100), {
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 0,
    });
    assert.equal(progressbarRange(12, Infinity), null);
    assert.deepEqual(progressbarRange(125, 100), {
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 100,
    });
  });

  it('only exposes progressbar semantics on tracking surfaces with a valid range', () => {
    for (const relativePath of [
      'web/src/views/HabitsView.jsx',
      'web/src/components/food/MacroBars.jsx',
    ]) {
      const source = read(relativePath);
      assert.match(source, /progressbarRange/);
      assert.match(source, /role=\{[^?]+\? 'progressbar' : 'status'\}/);
      assert.match(source, /\{\.\.\.[a-zA-Z]+Progress\}/);
    }
  });
});
