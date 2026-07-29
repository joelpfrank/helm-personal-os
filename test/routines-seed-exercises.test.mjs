// Regression test: POST /api/routines with inline exercises[] passed 9
// values to sql.reInsert, a 10-column prepared statement (routine_id,
// exercise_id, position, target_sets, target_reps, target_weight,
// target_time_seconds, target_distance_m, superset_group, notes) — the
// `notes` value silently landed in the `superset_group` column's parameter
// slot and better-sqlite3 threw for the missing 10th binding, so every
// routine creation with a seed exercise 500'd.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

describe('POST /api/routines — inline seed exercises round-trip all target fields', () => {
  let server, base, headers, tmpDir, db;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-routines-'));
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

  it('creates a routine with an inline seed exercise instead of 500ing', async () => {
    const ex = await call('POST', '/exercises', { name: 'Bench Press', kind: 'lifting' });
    assert.equal(ex.status, 201);

    const res = await call('POST', '/routines', {
      name: 'Push Day',
      exercises: [{
        exercise_id: ex.body.id,
        target_sets: 4,
        target_reps: 8,
        target_weight: 62.5,
        target_time_seconds: 45,
        target_distance_m: 12.5,
        superset_group: 2,
        notes: 'pause reps',
      }],
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('every seeded target field, superset_group, and notes survive intact', async () => {
    const ex = await call('POST', '/exercises', { name: 'Deadlift', kind: 'lifting' });
    const res = await call('POST', '/routines', {
      name: 'Pull Day',
      exercises: [{
        exercise_id: ex.body.id,
        target_sets: 5,
        target_reps: 3,
        target_weight: 120,
        target_time_seconds: 90,
        target_distance_m: 1.5,
        superset_group: 7,
        notes: 'reset each rep',
      }],
    });

    assert.equal(res.status, 201);
    const seeded = res.body.exercises[0];
    assert.equal(seeded.exercise_id, ex.body.id);
    assert.equal(seeded.target_sets, 5);
    assert.equal(seeded.target_reps, 3);
    assert.equal(seeded.target_weight, 120);
    assert.equal(seeded.target_time_seconds, 90);
    assert.equal(seeded.target_distance_m, 1.5);
    assert.equal(seeded.superset_group, 7, 'superset_group must not be silently dropped/misaligned');
    assert.equal(seeded.notes, 'reset each rep', 'notes must not land in the wrong column');

    // Read back from the routine GET too, independent of the POST response shape.
    const fetched = await call('GET', `/routines/${res.body.id}`);
    assert.equal(fetched.body.exercises[0].superset_group, 7);
    assert.equal(fetched.body.exercises[0].notes, 'reset each rep');
  });

  it('omitted superset_group defaults to null, not a misaligned value', async () => {
    const ex = await call('POST', '/exercises', { name: 'Overhead Press', kind: 'lifting' });
    const res = await call('POST', '/routines', {
      name: 'No Superset Day',
      exercises: [{ exercise_id: ex.body.id, notes: 'solo movement' }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.exercises[0].superset_group, null);
    assert.equal(res.body.exercises[0].notes, 'solo movement');
    assert.equal(res.body.exercises[0].target_sets, 3, 'default target_sets must be unaffected');
  });
});
