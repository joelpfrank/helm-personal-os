import { db } from '../db.js';
import { errors } from './errors.js';
import { notifyEnabled, sendTelegram } from './notify.js';

let timerHandle = null;
const MAX_TIMEOUT_MS = 2_147_000_000;

const readTimer = db.prepare(`
  SELECT id, workout_id, duration_seconds, repeat_enabled,
         notifications_enabled, next_fire_at, started_at
  FROM workout_rest_timer WHERE id = 1
`);
const readActiveWorkout = db.prepare('SELECT id FROM workouts WHERE ended_at IS NULL LIMIT 1');
const deleteTimer = db.prepare('DELETE FROM workout_rest_timer WHERE id = 1');
const insertTimer = db.prepare(`
  INSERT INTO workout_rest_timer (
    id, workout_id, duration_seconds, repeat_enabled,
    notifications_enabled, next_fire_at
  ) VALUES (1, ?, ?, ?, ?, ?)
`);
const advanceTimer = db.prepare('UPDATE workout_rest_timer SET next_fire_at = ? WHERE id = 1');

export function nextServerRestTimerDeadline(previousDeadlineMs, durationSeconds, nowMs = Date.now()) {
  const intervalMs = durationSeconds * 1000;
  const elapsedIntervals = Math.max(1, Math.ceil((nowMs - previousDeadlineMs) / intervalMs));
  return previousDeadlineMs + elapsedIntervals * intervalMs;
}

function publicState(row = readTimer.get()) {
  if (!row) return { running: false, notification_available: notifyEnabled() };
  return {
    running: true,
    workout_id: row.workout_id,
    duration_seconds: row.duration_seconds,
    repeat_enabled: !!row.repeat_enabled,
    notifications_enabled: !!row.notifications_enabled,
    next_fire_at: row.next_fire_at,
    started_at: row.started_at,
    remaining_seconds: Math.ceil((Date.parse(row.next_fire_at) - Date.now()) / 1000),
    notification_available: notifyEnabled(),
    notification_channel: 'telegram',
  };
}

export function getWorkoutRestTimer() {
  return publicState();
}

function cancelHandle() {
  if (timerHandle) clearTimeout(timerHandle);
  timerHandle = null;
}

function arm() {
  cancelHandle();
  const row = readTimer.get();
  if (!row) return;
  const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, Date.parse(row.next_fire_at) - Date.now()));
  timerHandle = setTimeout(fire, delay);
  timerHandle.unref?.();
}

async function fire() {
  timerHandle = null;
  const row = readTimer.get();
  if (!row) return;

  const active = readActiveWorkout.get();
  if (!active || active.id !== row.workout_id) {
    deleteTimer.run();
    return;
  }

  const deadlineMs = Date.parse(row.next_fire_at);
  const nowMs = Date.now();
  if (deadlineMs > nowMs + 20) {
    arm();
    return;
  }

  if (row.repeat_enabled) {
    const nextMs = nextServerRestTimerDeadline(deadlineMs, row.duration_seconds, nowMs);
    advanceTimer.run(new Date(nextMs).toISOString());
  } else {
    deleteTimer.run();
  }

  if (row.notifications_enabled) {
    const minutes = Math.floor(row.duration_seconds / 60);
    const seconds = row.duration_seconds % 60;
    const interval = `${minutes}:${String(seconds).padStart(2, '0')}`;
    await sendTelegram(`⏱️ Rest over — next set. ${interval}${row.repeat_enabled ? ' interval restarted.' : ''}`);
  }

  arm();
}

export function startWorkoutRestTimer({ durationSeconds, firstIntervalSeconds = durationSeconds, repeatEnabled, notificationsEnabled }) {
  const active = readActiveWorkout.get();
  if (!active) throw errors.conflict('no active workout');
  const nextFireAt = new Date(Date.now() + firstIntervalSeconds * 1000).toISOString();
  db.transaction(() => {
    deleteTimer.run();
    insertTimer.run(
      active.id,
      durationSeconds,
      repeatEnabled ? 1 : 0,
      notificationsEnabled ? 1 : 0,
      nextFireAt,
    );
  })();
  arm();
  return publicState();
}

export function stopWorkoutRestTimer() {
  cancelHandle();
  deleteTimer.run();
}

export function startWorkoutRestTimerScheduler() {
  arm();
}
