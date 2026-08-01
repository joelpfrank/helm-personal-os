// Behavior + safety tests for the ReDoS remediations.
//
// These lock in two fixes so the vulnerable forms can never come back:
//   1. slugify() — trailing-underscore trim rewritten to be non-backtracking.
//   2. parseBearerToken() — "Bearer <token>" parsed without a backtracking regex.
//
// The timing assertions are generous (seconds, not milliseconds) so they fail
// ONLY if a genuinely polynomial regex is reintroduced, never on a slow CI box.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { slugify } from '../server/src/lib/slug.js';
import { parseBearerToken } from '../server/src/auth.js';

function timed(fn) {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6; // ms
}

describe('slugify()', () => {
  it('produces the same slugs the old regex did', () => {
    assert.equal(slugify('Hello World'), 'hello_world');
    assert.equal(slugify('  Leading & trailing!!  '), 'leading_trailing');
    assert.equal(slugify('___weird___'), 'weird');
    assert.equal(slugify('a.b.c'), 'a_b_c');
    assert.equal(slugify('已经 done 123'), 'done_123');
    assert.equal(slugify('!!!'), '');
    assert.equal(slugify(''), '');
  });

  it('stays fast on adversarial underscore runs (no polynomial backtracking)', () => {
    const evil = '_'.repeat(100000) + 'a';
    const ms = timed(() => slugify(evil));
    assert.equal(slugify(evil), 'a');
    assert.ok(ms < 1000, `slugify took ${ms}ms — regex may be polynomial again`);
  });
});

describe('parseBearerToken()', () => {
  it('extracts the token, case-insensitively, trimming whitespace', () => {
    assert.equal(parseBearerToken('Bearer abc123'), 'abc123');
    assert.equal(parseBearerToken('bearer   abc123  '), 'abc123');
    assert.equal(parseBearerToken('BEARER\tabc123'), 'abc123');
  });

  it('rejects malformed or empty headers', () => {
    assert.equal(parseBearerToken(''), null);
    assert.equal(parseBearerToken('Basic abc123'), null);
    assert.equal(parseBearerToken('Bearer'), null);
    assert.equal(parseBearerToken('Bearer   '), null);
    assert.equal(parseBearerToken('Bearerabc'), null);
    assert.equal(parseBearerToken(undefined), null);
  });

  it('stays fast on adversarial whitespace runs', () => {
    const evil = 'Bearer ' + ' '.repeat(100000);
    const ms = timed(() => parseBearerToken(evil));
    assert.equal(parseBearerToken(evil), null);
    assert.ok(ms < 1000, `parseBearerToken took ${ms}ms — regex may be polynomial again`);
  });
});
