// Tri-state habit outcomes: every scheduled habit/day is Achieved (success),
// Not achieved (failed), or Unspecified (absence of an explicit outcome).
// A blank day must stay genuinely unspecified — never a silent failure.
// Uses an isolated temp DB + a throwaway port (never the live SQLite file
// or the live :8787 instance).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

let tmpDir; let server; let base; let headers;

// Reserve a free port up front: mcp/src/api.js freezes DASHBOARD_URL at import
// time, and the server's import chain loads it, so the env must point at the
// test server BEFORE any server/mcp module is imported.
async function reservePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-habitoutcome-'));
  process.env.DASHBOARD_DB_PATH = path.join(tmpDir, 'test.db');
  const port = await reservePort();
  process.env.DASHBOARD_URL = `http://127.0.0.1:${port}`;
  const { runMigrations } = await import('../server/src/db.js');
  runMigrations();
  const { getToken } = await import('../server/src/auth.js');
  process.env.DASHBOARD_TOKEN = getToken();
  const { createApp } = await import('../server/src/app.js');
  const app = createApp();
  await new Promise((r) => { server = app.listen(port, '127.0.0.1', r); });
  base = `http://127.0.0.1:${port}/api`;
  headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
});

after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function req(method, p, body) {
  const res = await fetch(base + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const DATE = '2026-07-10';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function makeHabit(overrides = {}) {
  const { json } = await req('POST', '/habits', { name: `H-${Math.random().toString(36).slice(2)}`, ...overrides });
  return json;
}

describe('outcome REST round-trip (set / read / clear)', () => {
  it('a fresh habit/day is unspecified with no explicit outcome', async () => {
    const h = await makeHabit();
    const { status, json } = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(status, 200);
    assert.equal(json.outcome, null, 'no explicit outcome yet');
    assert.equal(json.effective_status, 'unspecified', 'blank day is unspecified, not failed');
    assert.equal(json.completed, false);
  });

  it('PUT success then read reflects it; completed follows effective success', async () => {
    const h = await makeHabit();
    const put = await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'success' });
    assert.equal(put.status, 200);
    assert.equal(put.json.outcome, 'success');
    assert.equal(put.json.effective_status, 'success');
    assert.equal(put.json.completed, true);

    const get = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(get.json.outcome, 'success');
    assert.equal(get.json.effective_status, 'success');
  });

  it('PUT failed marks Not achieved without touching logs', async () => {
    const h = await makeHabit();
    const put = await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'failed' });
    assert.equal(put.status, 200);
    assert.equal(put.json.outcome, 'failed');
    assert.equal(put.json.effective_status, 'failed');
    assert.equal(put.json.completed, false, 'failed is never completed');
  });

  it('re-PUT overwrites the same habit/date (uniqueness, not a duplicate)', async () => {
    const h = await makeHabit();
    await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'success' });
    await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'failed' });
    const get = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(get.json.outcome, 'failed', 'second PUT overwrote the first');
  });

  it('DELETE clears back to unspecified (absence, not a fake failed)', async () => {
    const h = await makeHabit();
    await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'success' });
    const del = await req('DELETE', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.outcome, null);
    assert.equal(del.json.effective_status, 'unspecified');

    const get = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(get.json.outcome, null, 'cleared → genuinely unspecified');
    assert.equal(get.json.effective_status, 'unspecified');
  });

  it('DELETE on an already-unspecified day is a harmless no-op', async () => {
    const h = await makeHabit();
    const del = await req('DELETE', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.effective_status, 'unspecified');
  });
});

describe('outcome validation (4xx)', () => {
  it('rejects a non-integer habit id', async () => {
    const { status } = await req('PUT', '/habits/abc/outcome', { date: DATE, status: 'success' });
    assert.equal(status, 400);
  });

  it('404s for a missing habit on set/read/clear', async () => {
    assert.equal((await req('PUT', '/habits/999999/outcome', { date: DATE, status: 'success' })).status, 404);
    assert.equal((await req('GET', `/habits/999999/outcome?date=${DATE}`)).status, 404);
    assert.equal((await req('DELETE', `/habits/999999/outcome?date=${DATE}`)).status, 404);
  });

  it('rejects a missing or unknown status', async () => {
    const h = await makeHabit();
    assert.equal((await req('PUT', `/habits/${h.id}/outcome`, { date: DATE })).status, 400);
    assert.equal((await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'maybe' })).status, 400);
    // 'unspecified' is not a settable status — it is expressed by DELETE.
    assert.equal((await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'unspecified' })).status, 400);
  });

  it('rejects a malformed date on set/read/clear', async () => {
    const h = await makeHabit();
    assert.equal((await req('PUT', `/habits/${h.id}/outcome`, { date: '07-10-2026', status: 'success' })).status, 400);
    assert.equal((await req('GET', `/habits/${h.id}/outcome?date=nope`)).status, 400);
    assert.equal((await req('DELETE', `/habits/${h.id}/outcome?date=2026-13-40x`)).status, 400);
  });

  it('rejects unknown body keys', async () => {
    const h = await makeHabit();
    const { status } = await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'success', notes: 'x' });
    assert.equal(status, 400);
  });
});

describe('precedence with quantity logs', () => {
  it('absent outcome: quantity >= goal → success, else unspecified', async () => {
    const h = await makeHabit({ goal_quantity: 2, unit: 'glass' });
    let v = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(v.json.effective_status, 'unspecified', 'zero quantity is unspecified, not failed');

    await req('POST', `/habits/${h.id}/log`, { date: DATE, quantity: 1 });
    v = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(v.json.effective_status, 'unspecified', 'partial (1/2) is still unspecified');
    assert.equal(v.json.quantity, 1);

    await req('POST', `/habits/${h.id}/log`, { date: DATE, quantity: 1 });
    v = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(v.json.effective_status, 'success', 'reaching the goal → success');
    assert.equal(v.json.completed, true);
  });

  it('explicit failed overrides quantity that would otherwise be success', async () => {
    const h = await makeHabit({ goal_quantity: 1 });
    await req('POST', `/habits/${h.id}/log`, { date: DATE, quantity: 3 });
    await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'failed' });
    const v = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(v.json.effective_status, 'failed');
    assert.equal(v.json.completed, false, 'explicit failed is never completed even with logs');
    assert.equal(v.json.quantity, 3, 'logs are preserved untouched');
  });

  it('explicit success stands even with zero quantity; clearing reverts to quantity-derived', async () => {
    const h = await makeHabit({ goal_quantity: 5 });
    await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'success' });
    let v = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(v.json.effective_status, 'success');

    await req('DELETE', `/habits/${h.id}/outcome?date=${DATE}`);
    v = await req('GET', `/habits/${h.id}/outcome?date=${DATE}`);
    assert.equal(v.json.effective_status, 'unspecified', 'back to quantity-derived (0/5)');
  });

  it('setting and clearing an outcome never deletes quantity logs', async () => {
    const h = await makeHabit({ goal_quantity: 2 });
    await req('POST', `/habits/${h.id}/log`, { date: DATE, quantity: 2 });
    await req('PUT', `/habits/${h.id}/outcome`, { date: DATE, status: 'failed' });
    await req('DELETE', `/habits/${h.id}/outcome?date=${DATE}`);
    const logs = await req('GET', `/habits/${h.id}/logs?from=${DATE}&to=${DATE}`);
    assert.equal(logs.json.length, 1, 'the quantity log survives outcome churn');
    assert.equal(logs.json[0].quantity, 2);
  });
});

describe('effective status surfaces in today / calendar / stats', () => {
  const today = todayISO();

  it('/habits/today carries outcome + effective_status; failed is not completed', async () => {
    const h = await makeHabit({ goal_quantity: 1 });
    await req('POST', `/habits/${h.id}/log`, { date: today, quantity: 1 });
    await req('PUT', `/habits/${h.id}/outcome`, { date: today, status: 'failed' });
    const t = await req('GET', '/habits/today');
    const row = t.json.habits.find((x) => x.id === h.id);
    assert.ok(row, 'daily habit is scheduled today');
    assert.equal(row.outcome, 'failed');
    assert.equal(row.effective_status, 'failed');
    assert.equal(row.completed, false, 'explicit failed → not completed even with a log');
    assert.equal(row.today_quantity, 1, 'quantity preserved');
  });

  it('/habits/today marks quantity-complete habits as success with null outcome', async () => {
    const h = await makeHabit({ goal_quantity: 1 });
    await req('POST', `/habits/${h.id}/log`, { date: today, quantity: 1 });
    const t = await req('GET', '/habits/today');
    const row = t.json.habits.find((x) => x.id === h.id);
    assert.equal(row.outcome, null);
    assert.equal(row.effective_status, 'success');
    assert.equal(row.completed, true);
  });

  it('/habits/calendar distinguishes failed from unspecified on a day', async () => {
    const failed = await makeHabit({ goal_quantity: 1 });
    const blank = await makeHabit({ goal_quantity: 1 });
    await req('PUT', `/habits/${failed.id}/outcome`, { date: today, status: 'failed' });

    const cal = await req('GET', `/habits/calendar?from=${today}&to=${today}`);
    const f = cal.json.habits.find((x) => x.id === failed.id).entries[0];
    const b = cal.json.habits.find((x) => x.id === blank.id).entries[0];
    assert.equal(f.effective_status, 'failed');
    assert.equal(f.outcome, 'failed');
    assert.equal(f.met, false);
    assert.equal(b.effective_status, 'unspecified', 'a blank scheduled day is unspecified, not a miss');
    assert.equal(b.outcome, null);
    assert.equal(b.met, false);
    assert.notEqual(f.effective_status, b.effective_status, 'failed and blank are visibly different');
  });

  it('/stats reports success/failed/unspecified/resolved and excludes blanks from completion_rate', async () => {
    // Weekly-on-today habit so exactly the days we touch are scheduled and we
    // can reason about the counts precisely.
    const dow = new Date(today + 'T00:00:00').getDay() || 7; // 0=Sun→7
    const h = await makeHabit({ goal_quantity: 1, days_of_week: String(dow) });

    // Build three scheduled instances: today (success via log), and two prior
    // weeks (one explicit failed, one left blank/unspecified).
    const d = (weeksAgo) => {
      const base = new Date(today + 'T00:00:00');
      base.setDate(base.getDate() - weeksAgo * 7);
      const y = base.getFullYear();
      const m = String(base.getMonth() + 1).padStart(2, '0');
      const day = String(base.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    await req('POST', `/habits/${h.id}/log`, { date: d(0), quantity: 1 });   // success
    await req('PUT', `/habits/${h.id}/outcome`, { date: d(1), status: 'failed' }); // failed
    // d(2) left untouched → unspecified

    const s = await req('GET', `/habits/${h.id}/stats`);
    assert.equal(s.json.success_days, 1);
    assert.equal(s.json.failed_days, 1);
    assert.ok(s.json.unspecified_days >= 1, 'blank scheduled days are counted as unspecified');
    assert.equal(s.json.resolved_days, 2, 'resolved = success + failed');
    assert.equal(s.json.met_days, 1, 'met_days stays backward-compatible (= success_days)');
    // completion_rate = success / resolved = 1/2, NOT success / scheduled.
    assert.equal(s.json.completion_rate, 0.5,
      'blank days must not drag the completion rate down as if they were misses');
  });
});

describe('MCP set_habit_outcome (real handler, isolated service)', () => {
  it('marks success/failed and clears back to unspecified through the real handler', async () => {
    // DASHBOARD_URL/DASHBOARD_TOKEN already point at the test server (before()).
    const { registerTools } = await import('../mcp/src/tools.js');
    const tools = new Map();
    registerTools({ registerTool: (name, def, handler) => tools.set(name, { def, handler }) });

    const setOutcome = tools.get('set_habit_outcome');
    assert.ok(setOutcome, 'set_habit_outcome tool must be registered');
    assert.ok(setOutcome.def.inputSchema.status, 'set_habit_outcome must expose a status field');

    const create = tools.get('create_habit');
    const habit = JSON.parse((await create.handler({ name: `MCP-outcome-${Math.random().toString(36).slice(2)}` })).content[0].text);

    const marked = JSON.parse((await setOutcome.handler({ habit_id: habit.id, status: 'failed', date: DATE })).content[0].text);
    assert.equal(marked.outcome, 'failed');
    assert.equal(marked.effective_status, 'failed');
    assert.equal(marked.completed, false);

    const succeeded = JSON.parse((await setOutcome.handler({ habit_id: habit.id, status: 'success', date: DATE })).content[0].text);
    assert.equal(succeeded.outcome, 'success');
    assert.equal(succeeded.effective_status, 'success');

    const cleared = JSON.parse((await setOutcome.handler({ habit_id: habit.id, status: 'unspecified', date: DATE })).content[0].text);
    assert.equal(cleared.outcome, null);
    assert.equal(cleared.effective_status, 'unspecified');
  });

  it('list_today_habits and get_habit_stats descriptions document tri-state status', async () => {
    const { registerTools } = await import('../mcp/src/tools.js');
    const tools = new Map();
    registerTools({ registerTool: (name, def, handler) => tools.set(name, { def, handler }) });
    assert.match(tools.get('list_today_habits').def.description, /effective_status/);
    assert.match(tools.get('get_habit_stats').def.description, /unspecified/);
    assert.match(tools.get('get_habits_calendar').def.description, /effective_status/);
  });
});

describe('web outcome helper (pure behavior)', () => {
  it('maps each tri-state to a humane label and a non-color class', async () => {
    const { outcomeLabel, outcomeClass, nextOutcome } = await import('../web/src/lib/habitOutcome.js');
    assert.equal(outcomeLabel('success'), 'Achieved');
    assert.equal(outcomeLabel('failed'), 'Not achieved');
    assert.equal(outcomeLabel('unspecified'), 'Unspecified');
    assert.equal(outcomeLabel(null), 'Unspecified');
    // Distinct, non-color-only class hooks so failed ≠ unspecified visually AND structurally.
    assert.notEqual(outcomeClass('failed'), outcomeClass('unspecified'));
    assert.notEqual(outcomeClass('success'), outcomeClass('unspecified'));
  });

  it('toggling a pressed state clears to unspecified; pressing a new state sets it', async () => {
    const { nextOutcome } = await import('../web/src/lib/habitOutcome.js');
    // pressing Achieved when already Achieved → clear
    assert.equal(nextOutcome('success', 'success'), 'unspecified');
    // pressing Not achieved when Achieved → set failed
    assert.equal(nextOutcome('success', 'failed'), 'failed');
    // pressing Achieved when unspecified → set success
    assert.equal(nextOutcome('unspecified', 'success'), 'success');
    // pressing Not achieved when already failed → clear
    assert.equal(nextOutcome('failed', 'failed'), 'unspecified');
  });
});

describe('web store setOutcome action (source check — Vite-only module)', () => {
  // web/src/state/habits.js transitively imports api.js, which reads Vite's
  // import.meta.env at load and therefore can't be imported under plain Node.
  // We assert its wiring by source instead.
  const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

  it('defines setOutcome and routes success/failed → PUT, unspecified → DELETE', () => {
    const src = read('web/src/state/habits.js');
    assert.ok(src.includes('async setOutcome'), 'store must expose a setOutcome action');
    assert.ok(src.includes('apiPut') && src.includes('/outcome'), 'success/failed go to PUT /outcome');
    assert.ok(/apiDelete\(`\/habits\/\$\{id\}\/outcome/.test(src), 'unspecified clears via DELETE /outcome');
    assert.ok(src.includes('normalizeOutcome'), 'store normalizes the status through the shared helper');
    assert.ok(src.includes('fetchToday'), 'setOutcome refreshes today after writing');
  });

  it('web api.js exposes an apiPut helper for the PUT verb', () => {
    const src = read('web/src/api.js');
    assert.ok(src.includes('export const apiPut'), 'apiPut helper must exist');
  });
});

describe('UI wiring (source checks where DOM tests are impractical)', () => {
  const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

  it('HabitRow renders an accessible three-state outcome control', () => {
    const src = read('web/src/components/habits/HabitRow.jsx');
    assert.ok(src.includes('habitOutcome'), 'HabitRow should use the shared outcome helper');
    assert.ok(src.includes('onSetOutcome'), 'HabitRow must accept an onSetOutcome handler');
    assert.ok(src.includes('aria-pressed'), 'segments must expose pressed state to AT');
    assert.ok(src.includes("role=\"group\""), 'the control must be a labelled group');
    // Humane labels, and a failed indicator that is NOT a bare X.
    assert.ok(src.includes('Not achieved'), 'failed state has a humane text label');
    assert.ok(src.includes('effective_status'), 'row reflects the effective status');
    // The quantity ring (increment/decrement) is preserved.
    assert.ok(src.includes('ProgressRing') && src.includes('onIncrement') && src.includes('onDecrement'),
      'quantity increment/decrement must be preserved');
  });

  it('HabitsCalendar distinguishes failed from unspecified in class and title', () => {
    const src = read('web/src/components/habits/HabitsCalendar.jsx');
    assert.ok(src.includes("'failed'") || src.includes('failed'), 'calendar must render a failed cell class');
    assert.ok(src.includes('unspecified'), 'calendar must render an unspecified cell class distinct from a miss');
    assert.ok(src.includes('not achieved'), 'failed cells must be textually labelled (tooltip)');
    assert.ok(!/cls\.push\('miss'\)/.test(src), 'blank days must no longer be labelled a "miss"');
    assert.ok(src.includes('effective_status'), 'calendar cells key off effective_status');
  });

  it('styles.css carries distinct hooks for failed vs unspecified (not colour-only shapes)', () => {
    const src = read('web/src/styles.css');
    assert.ok(src.includes('.cal-cell.failed'), 'failed calendar cell style');
    assert.ok(src.includes('.cal-cell.unspecified'), 'unspecified calendar cell style');
    assert.ok(src.includes('.ho-seg'), 'outcome segment styles');
    assert.ok(src.includes('.habit-failed-pill'), 'failed row pill style');
  });
});
