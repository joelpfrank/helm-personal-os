// TDD tests: the coach knows board reality before it asks about priorities.
// RED first — the briefing/chat-context wiring must FAIL before the change.
//
// Behavior tests against an isolated DB + the real Express app.
//
// ISOLATION CONTRACT — read before touching this file:
//   • DASHBOARD_DB_PATH is set at MODULE SCOPE, before any dynamic import, so
//     db.js can only ever open the throwaway DB. Setting it inside a hook is
//     not safe: db.js is a module singleton, so the FIRST import wins and every
//     later env change is silently ignored while writes keep landing on the
//     first handle.
//   • Exactly ONE db, ONE app and ONE fixture set are shared by every suite
//     here. No suite re-seeds, so no duplicate fixture can accidentally satisfy
//     a count assertion (a second 'Renew passport' would make "1 overdue" pass
//     for the wrong reason).
//   • A guard in `before` asserts the open DB really is inside our temp dir.
//     Reordering these suites or running a subset cannot reach live data.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Env isolation, established once, before ANY server import ──────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-briefing-tasks-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');
process.env.DASHBOARD_URL = 'http://127.0.0.1:1';   // never dialed in this file

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

// The one service under test, shared by every suite in this file.
let server, base, headers, db, buildSystemPrompt;
const ids = {};

before(async () => {
  const dbMod = await import('../server/src/db.js');
  // Guard: if db.js ever opened anything but our throwaway DB, stop NOW rather
  // than seed fixtures into the user's real dashboard.
  assert.equal(path.dirname(dbMod.db.name), TMP,
    `refusing to run: db.js opened ${dbMod.db.name}, not the isolated test DB`);
  dbMod.runMigrations();
  db = dbMod.db;

  const { getToken } = await import('../server/src/auth.js');
  const { createApp } = await import('../server/src/app.js');
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  headers = { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };

  // ── The single fixture set ──
  const board = db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)');
  const column = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
  const card = db.prepare('INSERT INTO cards (column_id, title, due_date, position) VALUES (?, ?, ?, ?)');

  ids.life = board.run('LIFE', 1000).lastInsertRowid;
  ids.work = board.run('WORK', 2000).lastInsertRowid;
  ids.lifeTodo = column.run(ids.life, 'To do', 1000).lastInsertRowid;
  ids.lifeDone = column.run(ids.life, 'Done', 2000).lastInsertRowid;
  ids.workDoing = column.run(ids.work, 'In Progress', 1000).lastInsertRowid;

  ids.overdue = card.run(ids.lifeTodo, 'Renew passport', daysFromToday(-2), 1000).lastInsertRowid;
  ids.doneCard = card.run(ids.lifeDone, 'Pay rent', daysFromToday(-4), 1000).lastInsertRowid;
  ids.doing = card.run(ids.workDoing, 'Rewrite onboarding', null, 1000).lastInsertRowid;

  // A preserved legacy module must never be promoted into the simplified
  // Coach prompt, even though its backend data remains intact.
  db.prepare("INSERT INTO modules (name, label) VALUES (?, ?)")
    .run('secret_legacy_tracker', 'Secret Legacy Tracker');

  ({ buildSystemPrompt } = await import('../server/src/routes/chat.js'));
});

after(() => {
  if (server) server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function get(url) {
  const res = await fetch(base + url, { headers });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/coach/briefing - task_snapshot (isolated DB, real app)', () => {
  it('exposes a task_snapshot with real totals', async () => {
    const { status, body } = await get('/coach/briefing');
    assert.equal(status, 200);
    assert.ok(body.task_snapshot, 'briefing must carry task_snapshot');
    assert.equal(body.task_snapshot.totals.open, 2);
    assert.equal(body.task_snapshot.totals.done, 1);
    assert.equal(body.task_snapshot.totals.overdue, 1);
    assert.equal(body.task_snapshot.totals.in_progress, 1);
  });

  it('carries card ids and titles the coach can name and act on', async () => {
    const { body } = await get('/coach/briefing');
    const card = body.task_snapshot.cards.find((c) => c.id === ids.overdue);
    assert.ok(card, 'overdue card must be listed');
    assert.equal(card.title, 'Renew passport');
    assert.equal(card.board_name, 'LIFE');
    assert.equal(card.status, 'overdue');
    assert.equal(card.column_id, ids.lifeTodo);
  });

  it('excludes done-like cards from the actionable list', async () => {
    const { body } = await get('/coach/briefing');
    const listed = body.task_snapshot.cards.map((c) => c.id);
    assert.ok(!listed.includes(ids.doneCard), 'done card must not be offered as actionable');
  });

  it('keeps both LIFE and WORK visible', async () => {
    const { body } = await get('/coach/briefing');
    const names = new Set(body.task_snapshot.boards.map((b) => b.name));
    assert.ok(names.has('LIFE') && names.has('WORK'));
  });

  it('reading the briefing does not mutate tasks', async () => {
    const before = db.prepare('SELECT id, column_id, title, due_date FROM cards ORDER BY id').all();
    await get('/coach/briefing');
    const after = db.prepare('SELECT id, column_id, title, due_date FROM cards ORDER BY id').all();
    assert.deepEqual(after, before);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Chat coach context — the system prompt must contain board reality.
// Same DB, same fixtures, same service as the briefing suite above.
// ═══════════════════════════════════════════════════════════════════

describe('buildCoachContext - task-first system prompt (isolated DB)', () => {
  it('puts real board reality into the prompt, with ids', () => {
    const prompt = buildSystemPrompt();
    assert.match(prompt, /Board reality/i);
    assert.ok(prompt.includes('Renew passport'), 'prompt must name the real overdue card');
    assert.ok(prompt.includes(`[${ids.overdue}]`), 'prompt must carry the card id so the coach can act on it');
  });

  it('surfaces the open/overdue counts so the coach opens from evidence', () => {
    const prompt = buildSystemPrompt();
    // Pinned to the TOTALS line, not a bare /1 overdue/: a loose match is
    // satisfied by any per-board line and would hide a broken total.
    assert.match(prompt, /Totals: 2 open · 1 overdue · 0 due today · 1 in progress/);
  });

  it('does not offer done work as actionable', () => {
    const prompt = buildSystemPrompt();
    assert.ok(!prompt.includes('Pay rent'), 'done card must not appear as actionable work');
  });

  it('does not promote preserved hidden modules in the assembled prompt', () => {
    const prompt = buildSystemPrompt();
    assert.ok(!prompt.includes('Secret Legacy Tracker'));
    assert.ok(!prompt.includes('call list_modules'));
    assert.ok(!prompt.includes('Connected external tools'));
    assert.doesNotMatch(prompt, /\bmodules?\b/i);
  });
});
