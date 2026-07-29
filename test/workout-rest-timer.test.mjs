import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('workout rest timer math', () => {
  it('counts down from an absolute deadline so backgrounding does not lose time', async () => {
    const { restTimerSeconds } = await import('../web/src/lib/rest-timer.js');
    assert.equal(restTimerSeconds(10_000, 8_001), 2);
    assert.equal(restTimerSeconds(10_000, 10_000), 0);
    assert.equal(restTimerSeconds(10_000, 12_999), -2);
  });

  it('formats countdowns and overtime clearly', async () => {
    const { formatRestTimer } = await import('../web/src/lib/rest-timer.js');
    assert.equal(formatRestTimer(90), '1:30');
    assert.equal(formatRestTimer(0), '0:00');
    assert.equal(formatRestTimer(-7), '+0:07');
  });

  it('advances repeating intervals without drifting when a tick is late', async () => {
    const { nextRestTimerDeadline } = await import('../web/src/lib/rest-timer.js');
    assert.equal(nextRestTimerDeadline(10_000, 60, 10_001), 70_000);
    assert.equal(nextRestTimerDeadline(10_000, 60, 135_000), 190_000);
  });
});

describe('active workout rest timer UI', () => {
  it('offers practical rest presets and start, pause, and reset controls', () => {
    const src = read('web/src/components/workouts/ActiveWorkout.jsx');
    assert.match(src, /Rest timer/i);
    for (const seconds of [60, 90, 120, 180]) {
      assert.match(src, new RegExp(`value=\\{${seconds}\\}`));
    }
    assert.match(src, />start</i);
    assert.match(src, />pause</i);
    assert.match(src, />reset</i);
  });

  it('persists the chosen interval and alerts when rest is over', () => {
    const src = read('web/src/components/workouts/ActiveWorkout.jsx');
    assert.match(src, /localStorage/);
    assert.match(src, /navigator\.vibrate/);
  });

  it('customizes sound, vibration, phone notifications, and repeating intervals', () => {
    const src = read('web/src/components/workouts/ActiveWorkout.jsx');
    assert.match(src, /Sound/);
    assert.match(src, /value="bell"/);
    assert.match(src, /value="double"/);
    assert.match(src, /value="gong"/);
    assert.match(src, /Vibration/);
    assert.match(src, /Phone notifications/);
    assert.match(src, /Repeat intervals/);
    assert.match(src, /\/workouts\/rest-timer/);
  });

  it('explains that background phone alerts use Telegram device settings', () => {
    const src = read('web/src/components/workouts/ActiveWorkout.jsx');
    assert.match(src, /Telegram/i);
    assert.match(src, /closed|background/i);
  });
});
