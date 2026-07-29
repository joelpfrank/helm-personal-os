// TDD tests: the Midday Recalibration cadence, end to end.
// RED first — migration 022, the settings/check-in kinds, the briefing state
// and the MCP schemas must all FAIL before the production changes.
//
// Additive-only contract: 022 adds midday columns to coach_settings without
// disturbing any existing cadence configuration.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS = path.join(ROOT, 'server', 'src', 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

// Mirror production db.js: WAL is set BEFORE migrations, so 001's
// `PRAGMA journal_mode = WAL` is a no-op inside the migration transaction.
function newDb(Database, dir, upTo = null) {
  const db = new Database(path.join(dir, `t-${upTo || 'all'}.db`));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  return db;
}

function apply(db, files) {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    })();
  }
}

// ═══════════════════════════════════════════════════════════════════
// A. Migration 022 — additive defaults, existing settings preserved
// ═══════════════════════════════════════════════════════════════════

describe('Migration 022 - midday cadence', () => {
  let tmpDir, Database;

  before(async () => {
    ({ default: Database } = await import('better-sqlite3'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-midday-mig-'));
  });
  after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('lands after 021 as a new additive migration', () => {
    const files = migrationFiles();
    const midday = files.find((f) => /^022_/.test(f));
    assert.ok(midday, 'a 022_* migration must exist');
    const index = files.indexOf(midday);
    assert.match(files[index - 1], /^021_/, '022 must land immediately after 021');
  });

  it('defaults midday_enabled = 1 and midday_time = 13:00 on a fresh DB', () => {
    const db = newDb(Database, tmpDir);
    apply(db, migrationFiles());
    const row = db.prepare('SELECT midday_enabled, midday_time FROM coach_settings WHERE id = 1').get();
    assert.equal(row.midday_enabled, 1);
    assert.equal(row.midday_time, '13:00');
    db.close();
  });

  it('preserves existing cadence settings when upgrading an old DB', () => {
    const files = migrationFiles();
    const upTo021 = files.filter((f) => !/^022_/.test(f));
    const db = newDb(Database, tmpDir, '021');
    apply(db, upTo021);
    // A user who already customized their rhythm before midday existed.
    db.prepare(`UPDATE coach_settings SET morning_time = '06:30', evening_time = '22:15',
                weekly_dow = 3, morning_enabled = 0 WHERE id = 1`).run();

    apply(db, files.filter((f) => /^022_/.test(f)));

    const row = db.prepare(`SELECT morning_time, evening_time, weekly_dow, morning_enabled,
                            midday_enabled, midday_time FROM coach_settings WHERE id = 1`).get();
    assert.equal(row.morning_time, '06:30', 'existing morning_time must survive');
    assert.equal(row.evening_time, '22:15', 'existing evening_time must survive');
    assert.equal(row.weekly_dow, 3);
    assert.equal(row.morning_enabled, 0, 'a disabled cadence must stay disabled');
    assert.equal(row.midday_enabled, 1, 'new column takes its default');
    assert.equal(row.midday_time, '13:00');
    db.close();
  });
});

// ═══════════════════════════════════════════════════════════════════
// B–D. Settings, check-ins, briefing (isolated DB + real app)
// ═══════════════════════════════════════════════════════════════════

describe('Midday cadence API (isolated DB, real app)', () => {
  let server, base, headers, tmpDir, db, port;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-midday-api-'));
    process.env.DASHBOARD_DB_PATH = path.join(tmpDir, 'test.db');

    // DASHBOARD_URL must be set BEFORE any import: server/src/routes/chat.js
    // pulls in mcp/src/api.js, which snapshots URL_BASE at module load and
    // otherwise defaults to 127.0.0.1:8787 — the LIVE production server. So we
    // reserve a free port up front and point both the app and the MCP client
    // at it. Getting this wrong means the MCP tests drive real user data.
    port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const p = probe.address().port;
        probe.close(() => resolve(p));
      });
    });
    process.env.DASHBOARD_URL = `http://127.0.0.1:${port}`;

    const dbMod = await import('../server/src/db.js');
    dbMod.runMigrations();
    db = dbMod.db;
    const { getToken } = await import('../server/src/auth.js');
    process.env.DASHBOARD_TOKEN = getToken();
    const { createApp } = await import('../server/src/app.js');
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(port, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${port}/api`;
    headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
  });

  after(() => {
    if (server) server.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function call(method, url, body) {
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }

  it('GET /coach/settings exposes the midday cadence', async () => {
    const { status, body } = await call('GET', '/coach/settings');
    assert.equal(status, 200);
    assert.equal(body.midday_enabled, 1);
    assert.equal(body.midday_time, '13:00');
  });

  it('PATCH /coach/settings accepts a valid midday_time', async () => {
    const { status, body } = await call('PATCH', '/coach/settings', { midday_time: '12:45' });
    assert.equal(status, 200);
    assert.equal(body.midday_time, '12:45');
  });

  it('PATCH /coach/settings rejects a malformed midday_time', async () => {
    const { status } = await call('PATCH', '/coach/settings', { midday_time: '1pm' });
    assert.equal(status, 400, 'malformed time must be rejected, not silently stored');
    const { body } = await call('GET', '/coach/settings');
    assert.equal(body.midday_time, '12:45', 'rejected write must not corrupt the stored value');
  });

  it('rejects impossible times on every cadence field', async () => {
    // A shape-only /^\d{2}:\d{2}$/ check waves these through, and a cadence
    // stored at 99:99 is worse than a rejected one: it never comes due again,
    // silently, and the user just stops being asked.
    for (const field of ['morning_time', 'midday_time', 'evening_time']) {
      for (const bad of ['99:99', '24:00', '12:60', '25:30']) {
        const { status } = await call('PATCH', '/coach/settings', { [field]: bad });
        assert.equal(status, 400, `${field}=${bad} is not a real time and must be rejected`);
      }
    }
    const { body } = await call('GET', '/coach/settings');
    assert.equal(body.midday_time, '12:45', 'rejected writes must not corrupt stored values');
    assert.equal(body.morning_time, '08:00', 'the untouched default must survive rejected writes');
  });

  it('still accepts every valid 24h time, including the boundaries', async () => {
    for (const good of ['00:00', '23:59', '09:05']) {
      const { status, body } = await call('PATCH', '/coach/settings', { morning_time: good });
      assert.equal(status, 200, `${good} is a real time and must be accepted`);
      assert.equal(body.morning_time, good);
    }
    await call('PATCH', '/coach/settings', { morning_time: '08:00' });   // back to the default
  });

  it('PATCH /coach/settings toggles midday_enabled', async () => {
    let res = await call('PATCH', '/coach/settings', { midday_enabled: false });
    assert.equal(res.body.midday_enabled, 0);
    res = await call('PATCH', '/coach/settings', { midday_enabled: true });
    assert.equal(res.body.midday_enabled, 1);
  });

  it('accepts kind=midday check-ins and round-trips the payload', async () => {
    const payload = {
      progress: 'must-win card 3 half done',
      must_win_card_id: 3,          // singular: exactly one must-win exists
      decision: 'continue',
      reordered: false,
    };
    const post = await call('POST', '/coach/checkins', { kind: 'midday', payload });
    assert.equal(post.status, 201);
    assert.equal(post.body.kind, 'midday');
    assert.deepEqual(post.body.payload, payload);

    const today = await call('GET', '/coach/checkins/today/midday');
    assert.equal(today.status, 200);
    assert.deepEqual(today.body.payload, payload);

    const listed = await call('GET', '/coach/checkins?kind=midday');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].kind, 'midday');
  });

  it('still rejects unknown check-in kinds', async () => {
    const { status } = await call('POST', '/coach/checkins', { kind: 'brunch', payload: {} });
    assert.equal(status, 400);
  });

  it('briefing reports midday pending, then done after the check-in', async () => {
    // The check-in above already exists for today, so midday is satisfied.
    let { body } = await call('GET', '/coach/briefing');
    assert.equal(body.cadence_pending.midday, false, 'a saved midday check-in clears pending');
    assert.ok(body.today.midday_check_in, 'today.midday_check_in must carry the saved check-in');
    assert.equal(body.today.midday_check_in.payload.decision, 'continue');

    // Remove it → pending flips back on, but ONLY once there is a morning to
    // recalibrate against and the clock is past midday_time. Seed both: a
    // command meeting for today, and a midday_time already in the past.
    db.prepare("DELETE FROM check_ins WHERE kind = 'midday'").run();
    await call('POST', '/coach/checkins', { kind: 'morning', payload: { must_win_card_id: 3 } });
    await call('PATCH', '/coach/settings', { midday_time: '00:00' });

    ({ body } = await call('GET', '/coach/briefing'));
    assert.equal(body.cadence_pending.midday, true);
    assert.equal(body.today.midday_check_in, null);

    await call('PATCH', '/coach/settings', { midday_time: '12:45' });   // restore
  });

  it('is not pending before its configured time, on the API and not just in the UI', async (t) => {
    const soon = new Date(Date.now() + 5 * 60_000);
    if (soon.getDate() !== new Date().getDate()) {
      t.skip('within 5 minutes of midnight; the boundary is covered deterministically in cadence-due.test.mjs');
      return;
    }
    const hh = String(soon.getHours()).padStart(2, '0');
    const mm = String(soon.getMinutes()).padStart(2, '0');
    await call('PATCH', '/coach/settings', { midday_time: `${hh}:${mm}` });

    const { body } = await call('GET', '/coach/briefing');
    assert.equal(body.cadence_pending.midday, false,
      'a midday check-in 5 minutes in the future must not already be pending');

    await call('PATCH', '/coach/settings', { midday_time: '12:45' });   // restore
  });

  it('is not pending while today has no command meeting to recalibrate against', async () => {
    await call('PATCH', '/coach/settings', { midday_time: '00:00' });   // due by the clock
    db.prepare("DELETE FROM check_ins WHERE kind = 'morning'").run();

    const { body } = await call('GET', '/coach/briefing');
    assert.equal(body.cadence_pending.midday, false,
      'recalibrating against a plan that was never made is noise, not coaching');

    // With the morning cadence switched off there is nothing to wait for.
    await call('PATCH', '/coach/settings', { morning_enabled: false });
    const after = await call('GET', '/coach/briefing');
    assert.equal(after.body.cadence_pending.midday, true,
      'with no morning cadence at all, midday stands on its own');

    await call('PATCH', '/coach/settings', { morning_enabled: true, midday_time: '12:45' });
  });

  it('a disabled midday cadence is never pending', async () => {
    await call('PATCH', '/coach/settings', { midday_enabled: false });
    const { body } = await call('GET', '/coach/briefing');
    assert.equal(body.cadence_pending.midday, false);
    await call('PATCH', '/coach/settings', { midday_enabled: true });
  });

  // ---- MCP handler roundtrip against this same isolated service ----

  it('MCP log_check_in accepts kind=midday and update_coach_settings sets midday_time', async () => {
    // Guard: if URL_BASE ever resolved to anything but our isolated service,
    // fail loudly rather than mutate the live dashboard.
    const { api } = await import('../mcp/src/api.js');
    assert.equal(process.env.DASHBOARD_URL, `http://127.0.0.1:${port}`);
    const { runTool, getAnthropicTools } = await import('../mcp/src/tools-anthropic.js');
    const probe = await api('GET', '/coach/settings');
    assert.equal(probe.midday_time, '12:45',
      'MCP client must be talking to the isolated test service, not production');

    const logged = await runTool('log_check_in', {
      kind: 'midday',
      payload: { decision: 'reorder', must_win_card_id: 7 },
      coach_summary: 'Swapped to the overdue passport card.',
    });
    const saved = JSON.parse(logged.content[0].text);
    assert.equal(saved.kind, 'midday');
    assert.equal(saved.payload.decision, 'reorder');

    const updated = await runTool('update_coach_settings', { midday_time: '13:30' });
    assert.equal(JSON.parse(updated.content[0].text).midday_time, '13:30');

    // Schemas must advertise midday, or the model can never call it.
    const tools = getAnthropicTools();
    const logTool = tools.find((t) => t.name === 'log_check_in');
    assert.ok(JSON.stringify(logTool.input_schema).includes('midday'),
      'log_check_in schema must allow kind=midday');
    const settingsTool = tools.find((t) => t.name === 'update_coach_settings');
    assert.ok(Object.keys(settingsTool.input_schema.properties).includes('midday_time'),
      'update_coach_settings must expose midday_time');
    assert.ok(Object.keys(settingsTool.input_schema.properties).includes('midday_enabled'),
      'update_coach_settings must expose midday_enabled');
  });
});
