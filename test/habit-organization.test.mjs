// Flexible habit organization: time_of_day + category fields end-to-end.
// Uses an isolated temp DB (never the live SQLite file).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

let tmpDir; let server; let base; let headers;

// Reserve a free port up front: mcp/src/api.js freezes DASHBOARD_URL at
// import time, and the server's own import chain loads it, so the env
// must point at the test server BEFORE any server module is imported —
// otherwise MCP tool calls would hit the live instance on :8787.
async function reservePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-habitorg-'));
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

describe('habit organization fields (API)', () => {
  it('defaults: habit created without new fields gets anytime + empty category', async () => {
    const { status, json } = await req('POST', '/habits', { name: 'Plain habit' });
    assert.equal(status, 201);
    assert.equal(json.time_of_day, 'anytime');
    assert.equal(json.category, '');
  });

  it('create round-trips time_of_day and trims category', async () => {
    const { status, json } = await req('POST', '/habits', {
      name: 'Morning run', time_of_day: 'morning', category: '  Health ',
    });
    assert.equal(status, 201);
    assert.equal(json.time_of_day, 'morning');
    assert.equal(json.category, 'Health');

    const one = await req('GET', `/habits/${json.id}`);
    assert.equal(one.json.time_of_day, 'morning');
    assert.equal(one.json.category, 'Health');

    const list = await req('GET', '/habits');
    const found = list.json.find((h) => h.id === json.id);
    assert.equal(found.time_of_day, 'morning');
    assert.equal(found.category, 'Health');

    const today = await req('GET', '/habits/today');
    const t = today.json.habits.find((h) => h.id === json.id);
    assert.ok(t, 'daily habit should be scheduled today');
    assert.equal(t.time_of_day, 'morning');
    assert.equal(t.category, 'Health');

    const cal = await req('GET', '/habits/calendar');
    const c = cal.json.habits.find((h) => h.id === json.id);
    assert.equal(c.time_of_day, 'morning');
    assert.equal(c.category, 'Health');
  });

  it('normalizes empty/null time_of_day to anytime and blank category to empty string', async () => {
    const a = await req('POST', '/habits', { name: 'Blank tod', time_of_day: '', category: '   ' });
    assert.equal(a.status, 201);
    assert.equal(a.json.time_of_day, 'anytime');
    assert.equal(a.json.category, '');

    const b = await req('POST', '/habits', { name: 'Null tod', time_of_day: null, category: null });
    assert.equal(b.status, 201);
    assert.equal(b.json.time_of_day, 'anytime');
    assert.equal(b.json.category, '');

    const c = await req('POST', '/habits', { name: 'Cased tod', time_of_day: ' Evening ' });
    assert.equal(c.status, 201);
    assert.equal(c.json.time_of_day, 'evening');
  });

  it('rejects invalid time_of_day and oversized/malformed category with 4xx', async () => {
    for (const bad of [
      { name: 'Bad1', time_of_day: 'noonish' },
      { name: 'Bad2', time_of_day: 42 },
      { name: 'Bad3', category: 'x'.repeat(51) },
      { name: 'Bad4', category: { nested: true } },
    ]) {
      const { status } = await req('POST', '/habits', bad);
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
  });

  it('PATCH round-trips and validates the new fields', async () => {
    const { json: h } = await req('POST', '/habits', { name: 'Patch me' });

    const ok = await req('PATCH', `/habits/${h.id}`, { time_of_day: 'night', category: ' Work ' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.time_of_day, 'night');
    assert.equal(ok.json.category, 'Work');

    const clear = await req('PATCH', `/habits/${h.id}`, { time_of_day: null, category: null });
    assert.equal(clear.status, 200);
    assert.equal(clear.json.time_of_day, 'anytime');
    assert.equal(clear.json.category, '');

    const bad1 = await req('PATCH', `/habits/${h.id}`, { time_of_day: 'brunch' });
    assert.equal(bad1.status, 400);
    const bad2 = await req('PATCH', `/habits/${h.id}`, { category: 'x'.repeat(51) });
    assert.equal(bad2.status, 400);

    // failed patches must not have changed anything
    const after1 = await req('GET', `/habits/${h.id}`);
    assert.equal(after1.json.time_of_day, 'anytime');
    assert.equal(after1.json.category, '');
  });

  it('existing operations still work alongside the new fields', async () => {
    const { json: h } = await req('POST', '/habits', {
      name: 'Log me', time_of_day: 'afternoon', category: 'Diet', goal_quantity: 2, unit: 'glass',
    });
    const log = await req('POST', `/habits/${h.id}/log`, { quantity: 2 });
    assert.equal(log.status, 201);
    const stats = await req('GET', `/habits/${h.id}/stats`);
    assert.equal(stats.status, 200);
    assert.equal(stats.json.met_days, 1);
    const undo = await req('DELETE', `/habits/${h.id}/log/last`);
    assert.equal(undo.status, 200);
    const arch = await req('PATCH', `/habits/${h.id}`, { archived: true });
    assert.equal(arch.status, 200);
    const listArchived = await req('GET', '/habits?include=archived');
    const found = listArchived.json.find((x) => x.id === h.id);
    assert.equal(found.time_of_day, 'afternoon');
    assert.equal(found.category, 'Diet');
  });
});

describe('MCP tools expose organization fields', () => {
  it('create_habit and edit_habit round-trip time_of_day/category through real handlers', async () => {
    // DASHBOARD_URL/DASHBOARD_TOKEN already point at the test server (see before()).
    const { registerTools } = await import('../mcp/src/tools.js');
    const tools = new Map();
    registerTools({ registerTool: (name, def, handler) => tools.set(name, { def, handler }) });

    const create = tools.get('create_habit');
    assert.ok(create.def.inputSchema.time_of_day, 'create_habit schema must expose time_of_day');
    assert.ok(create.def.inputSchema.category, 'create_habit schema must expose category');

    const edit = tools.get('edit_habit');
    assert.ok(edit.def.inputSchema.time_of_day, 'edit_habit schema must expose time_of_day');
    assert.ok(edit.def.inputSchema.category, 'edit_habit schema must expose category');

    const created = JSON.parse((await create.handler({
      name: 'MCP habit', time_of_day: 'evening', category: 'Relationships',
    })).content[0].text);
    assert.equal(created.time_of_day, 'evening');
    assert.equal(created.category, 'Relationships');

    const edited = JSON.parse((await edit.handler({
      habit_id: created.id, time_of_day: 'morning', category: 'Health',
    })).content[0].text);
    assert.equal(edited.time_of_day, 'morning');
    assert.equal(edited.category, 'Health');
  });
});

describe('grouping helper (web)', () => {
  it('groups by time in human order, omitting empty groups', async () => {
    const { groupHabits } = await import('../web/src/lib/habitGroups.js');
    const habits = [
      { id: 1, name: 'A', time_of_day: 'anytime', category: '' },
      { id: 2, name: 'B', time_of_day: 'night', category: '' },
      { id: 3, name: 'C', time_of_day: 'morning', category: '' },
      { id: 4, name: 'D', time_of_day: 'morning', category: '' },
    ];
    const groups = groupHabits(habits, 'time');
    assert.deepEqual(groups.map((g) => g.label), ['Morning', 'Night', 'Anytime']);
    assert.deepEqual(groups[0].habits.map((h) => h.id), [3, 4], 'position order preserved within group');
  });

  it('groups by category with blanks under Uncategorized last', async () => {
    const { groupHabits } = await import('../web/src/lib/habitGroups.js');
    const habits = [
      { id: 1, name: 'A', time_of_day: 'anytime', category: 'Work' },
      { id: 2, name: 'B', time_of_day: 'anytime', category: '' },
      { id: 3, name: 'C', time_of_day: 'anytime', category: 'Health' },
      { id: 4, name: 'D', time_of_day: 'anytime', category: 'work' },
    ];
    const groups = groupHabits(habits, 'category');
    assert.deepEqual(groups.map((g) => g.label), ['Health', 'Work', 'Uncategorized']);
    assert.deepEqual(groups[1].habits.map((h) => h.id), [1, 4], 'case-insensitive merge, first casing wins');
  });

  it('none mode returns the single ordered list', async () => {
    const { groupHabits } = await import('../web/src/lib/habitGroups.js');
    const habits = [{ id: 2 }, { id: 1 }];
    const groups = groupHabits(habits, 'none');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, null);
    assert.deepEqual(groups[0].habits.map((h) => h.id), [2, 1]);
  });
});

describe('UI wiring (source checks where DOM tests are impractical)', () => {
  const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

  it('HabitForm offers time-of-day choices and a category input with suggestions', () => {
    const src = read('web/src/components/habits/HabitForm.jsx');
    assert.ok(src.includes('habitGroups') && src.includes('TIME_ORDER'),
      'HabitForm should render the shared time-of-day options (morning…anytime)');
    assert.ok(src.includes('time_of_day'), 'HabitForm must save time_of_day');
    assert.ok(src.includes('category'), 'HabitForm missing category field');
    assert.ok(src.includes('datalist'), 'HabitForm should suggest existing categories');
  });

  it('HabitsView has a persisted grouping control with time/category/none', () => {
    const src = read('web/src/views/HabitsView.jsx');
    assert.ok(src.includes('groupHabits'), 'HabitsView should use the grouping helper');
    assert.ok(src.includes('localStorage'), 'grouping preference must persist locally');
    assert.ok(src.includes("'time'") && src.includes("'category'") && src.includes("'none'"),
      'HabitsView must offer time/category/none grouping');
  });
});
