// TDD tests: midday due semantics as SHARED server logic.
// RED first — server/src/lib/cadence.js must not exist yet.
//
// Why this lives on the server: `cadence_pending.midday` is consumed by the
// API, the MCP tools and the Telegram channel. If "is it due yet?" only exists
// in the browser, every non-browser caller sees midday as pending from 00:01
// and nags about a plan that hasn't been made — the Today UI merely *hides*
// what the rest of the system still believes.
//
// Pure on purpose: no DB, no clock reads. `now` is injected, so before/after
// the due time is tested deterministically instead of hoping CI runs at 2pm.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// A fixed wall clock on a fixed day, so these tests never go flaky.
const at = (h, m = 0) => new Date(2026, 6, 16, h, m, 0);

const SETTINGS = { morning_enabled: 1, midday_enabled: 1, midday_time: '13:00' };
const MORNING = { id: 1, kind: 'morning', date: '2026-07-16' };

describe('middayPending - shared due logic', () => {
  let middayPending;

  before(async () => {
    ({ middayPending } = await import('../server/src/lib/cadence.js'));
  });

  const due = (opts) => middayPending({ settings: SETTINGS, morningCheckIn: MORNING, ...opts });

  it('is false before the configured midday time', () => {
    assert.equal(due({ now: at(9) }), false);
    assert.equal(due({ now: at(12, 59) }), false, 'one minute early is still early');
  });

  it('is true at and after the configured midday time', () => {
    assert.equal(due({ now: at(13, 0) }), true, 'due exactly on the minute');
    assert.equal(due({ now: at(17) }), true);
  });

  it('honours a custom midday_time', () => {
    const settings = { ...SETTINGS, midday_time: '11:30' };
    assert.equal(middayPending({ settings, morningCheckIn: MORNING, now: at(11, 29) }), false);
    assert.equal(middayPending({ settings, morningCheckIn: MORNING, now: at(11, 30) }), true);
  });

  it('is false once the midday check-in is saved', () => {
    const middayCheckIn = { id: 2, kind: 'midday', date: '2026-07-16' };
    assert.equal(due({ now: at(15), middayCheckIn }), false);
  });

  it('is false when the midday cadence is disabled', () => {
    const settings = { ...SETTINGS, midday_enabled: 0 };
    assert.equal(middayPending({ settings, morningCheckIn: MORNING, now: at(15) }), false);
  });

  it('is false while the morning command meeting has not happened', () => {
    // Recalibrating against a plan that was never made is noise, not coaching.
    assert.equal(due({ now: at(15), morningCheckIn: null }), false);
  });

  it('stands on its own when the morning cadence is switched off entirely', () => {
    // No morning cadence means there is no meeting to wait for — gating midday
    // on it forever would make the card permanently unreachable.
    const settings = { ...SETTINGS, morning_enabled: 0 };
    assert.equal(middayPending({ settings, morningCheckIn: null, now: at(15) }), true);
    assert.equal(middayPending({ settings, morningCheckIn: null, now: at(9) }), false,
      'still not due before its time');
  });

  it('falls back to 13:00 when midday_time is missing or malformed', () => {
    for (const midday_time of [undefined, null, '', 'nonsense', '99:99']) {
      const settings = { ...SETTINGS, midday_time };
      assert.equal(middayPending({ settings, morningCheckIn: MORNING, now: at(9) }), false,
        `${midday_time} must fall back to 13:00, not become due at midnight`);
      assert.equal(middayPending({ settings, morningCheckIn: MORNING, now: at(13) }), true,
        `${midday_time} must fall back to 13:00, not hide the card forever`);
    }
  });

  it('returns a real boolean, never a truthy setting value', () => {
    // cadence_pending crosses JSON to the UI/MCP; `1 && !null` would ship a
    // number and read as a bug at the far end.
    assert.strictEqual(due({ now: at(15) }), true);
    assert.strictEqual(due({ now: at(9) }), false);
  });
});

describe('isValidHHMM - real 24h time validation', () => {
  let isValidHHMM;

  before(async () => {
    ({ isValidHHMM } = await import('../server/src/lib/cadence.js'));
  });

  it('accepts valid 24h times including the boundaries', () => {
    for (const v of ['00:00', '09:05', '13:00', '23:59']) {
      assert.equal(isValidHHMM(v), true, `${v} is a real time`);
    }
  });

  it('rejects impossible times that match a naive \\d{2}:\\d{2} shape', () => {
    for (const v of ['99:99', '24:00', '25:00', '12:60', '13:99', '-1:00']) {
      assert.equal(isValidHHMM(v), false, `${v} is not a real time`);
    }
  });

  it('rejects malformed and non-string input', () => {
    for (const v of ['1pm', '7:00', '13:0', '13:00:00', '', ' ', null, undefined, 1300, {}]) {
      assert.equal(isValidHHMM(v), false, `${JSON.stringify(v)} is not HH:MM`);
    }
  });
});
