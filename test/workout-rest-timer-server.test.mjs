import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('server-backed workout rest timer', () => {
  let server, base, headers, tmpDir, db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-rest-timer-'));
    process.env.DASHBOARD_DB_PATH = path.join(tmpDir, 'test.db');
    process.env.HELM_DISABLE_TELEGRAM_NOTIFICATIONS = '1';

    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const value = probe.address().port;
        probe.close(() => resolve(value));
      });
    });
    process.env.DASHBOARD_URL = `http://127.0.0.1:${port}`;

    const dbMod = await import('../server/src/db.js');
    db = dbMod.db;
    const { getToken } = await import('../server/src/auth.js');
    process.env.DASHBOARD_TOKEN = getToken();
    const { createApp } = await import('../server/src/app.js');
    server = await new Promise((resolve) => {
      const value = createApp().listen(port, '127.0.0.1', () => resolve(value));
    });
    base = `http://127.0.0.1:${port}/api`;
    headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { db?.close(); } catch {}
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.HELM_DISABLE_TELEGRAM_NOTIFICATIONS;
    delete process.env.DASHBOARD_TOKEN;
  });

  async function call(method, url, body) {
    const response = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  }

  it('ships an additive persistent timer table', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'server/src/migrations/023_workout_rest_timer.sql'), 'utf8');
    assert.match(migration, /CREATE TABLE (?:IF NOT EXISTS )?workout_rest_timer/i);
    const columns = db.prepare('PRAGMA table_info(workout_rest_timer)').all().map((row) => row.name);
    assert.deepEqual(columns, [
      'id', 'workout_id', 'duration_seconds', 'repeat_enabled',
      'notifications_enabled', 'next_fire_at', 'started_at',
    ]);
  });

  it('returns a successful empty active-workout response for a normal blank workspace', async () => {
    const active = await call('GET', '/workouts/active');
    assert.equal(active.status, 200);
    assert.equal(active.body, null);

    const { resolveActiveWorkout } = await import('../mcp/src/resolve.js');
    await assert.rejects(
      resolveActiveWorkout(),
      /no active workout — call start_workout first/,
    );
  });

  it('starts, reads back, and stops a repeating timer tied to the active workout', async () => {
    const workout = await call('POST', '/workouts', { name: 'Timer test' });
    assert.equal(workout.status, 201);

    const started = await call('POST', '/workouts/rest-timer', {
      duration_seconds: 90,
      repeat_enabled: true,
      notifications_enabled: true,
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.running, true);
    assert.equal(started.body.workout_id, workout.body.id);
    assert.equal(started.body.duration_seconds, 90);
    assert.equal(started.body.repeat_enabled, true);
    assert.equal(started.body.notifications_enabled, true);
    assert.ok(Date.parse(started.body.next_fire_at) > Date.now());

    const readback = await call('GET', '/workouts/rest-timer');
    assert.equal(readback.status, 200);
    assert.equal(readback.body.running, true);
    assert.equal(readback.body.duration_seconds, 90);

    const stopped = await call('DELETE', '/workouts/rest-timer');
    assert.equal(stopped.status, 200);
    assert.deepEqual(stopped.body, { running: false });
    const empty = await call('GET', '/workouts/rest-timer');
    assert.deepEqual(empty.body.running, false);
  });

  it('rejects unsafe intervals and unknown fields', async () => {
    const tooShort = await call('POST', '/workouts/rest-timer', { duration_seconds: 5 });
    assert.equal(tooShort.status, 400);
    const unknown = await call('POST', '/workouts/rest-timer', { duration_seconds: 60, surprise: true });
    assert.equal(unknown.status, 400);
  });
});
