// TDD tests: server-side task snapshot/synthesis over real boards/columns/cards.
// RED first — these must FAIL before server/src/lib/task-snapshot.js exists.
//
// Contract: the snapshot is READ-ONLY board reality for the coach. It never
// mutates tasks. It is bounded (so it can live in a system prompt) but must
// stay useful: due/overdue/doing win the budget, and every board keeps some
// visibility so LIFE never hides WORK (or vice versa).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');

function migrate(db) {
  // Mirror production db.js ordering: WAL is set BEFORE migrations run, so
  // 001_init.sql's `PRAGMA journal_mode = WAL` is a no-op when it executes
  // inside the migration transaction. Without this, SQLite raises
  // "cannot change into wal mode from within a transaction" and the whole
  // suite dies in the hook instead of on the behavior under test.
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const dir = path.join(ROOT, 'server', 'src', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    })();
  }
}

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

describe('buildTaskSnapshot - board reality (isolated DB fixtures)', () => {
  let db, tmpDir, buildTaskSnapshot;
  const ids = {};

  before(async () => {
    const { default: Database } = await import('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-tasksnap-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    db.pragma('foreign_keys = ON');
    migrate(db);

    const board = db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)');
    const column = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
    const card = db.prepare(
      'INSERT INTO cards (column_id, title, due_date, position, updated_at) VALUES (?, ?, ?, ?, ?)',
    );

    ids.life = board.run('LIFE', 1000).lastInsertRowid;
    ids.work = board.run('WORK', 2000).lastInsertRowid;

    ids.lifeTodo  = column.run(ids.life, 'To do', 1000).lastInsertRowid;
    ids.lifeDoing = column.run(ids.life, 'Doing', 2000).lastInsertRowid;
    ids.lifeDone  = column.run(ids.life, 'Done', 3000).lastInsertRowid;

    ids.workTodo      = column.run(ids.work, 'Backlog', 1000).lastInsertRowid;
    ids.workProgress  = column.run(ids.work, 'In Progress', 2000).lastInsertRowid;
    ids.workCompleted = column.run(ids.work, 'Completed', 3000).lastInsertRowid;
    ids.workArchived  = column.run(ids.work, 'Archived', 4000).lastInsertRowid;

    const fresh = new Date().toISOString();
    const old = '2020-01-01T00:00:00.000Z';

    // LIFE
    ids.overdueCard = card.run(ids.lifeTodo, 'Renew passport', daysFromToday(-3), 1000, fresh).lastInsertRowid;
    ids.dueTodayCard = card.run(ids.lifeTodo, 'Call dentist', daysFromToday(0), 2000, fresh).lastInsertRowid;
    ids.undatedFresh = card.run(ids.lifeTodo, 'Buy running shoes', null, 3000, fresh).lastInsertRowid;
    ids.staleCard = card.run(ids.lifeTodo, 'Sort the garage', null, 4000, old).lastInsertRowid;
    ids.doingCard = card.run(ids.lifeDoing, 'Read Atomic Habits', null, 1000, fresh).lastInsertRowid;
    ids.doneCard = card.run(ids.lifeDone, 'Pay rent', daysFromToday(-5), 1000, fresh).lastInsertRowid;

    // WORK
    ids.workOverdue = card.run(ids.workTodo, 'Ship Q3 report', daysFromToday(-1), 1000, fresh).lastInsertRowid;
    ids.workFuture = card.run(ids.workTodo, 'Plan offsite', daysFromToday(10), 2000, fresh).lastInsertRowid;
    ids.workDoing = card.run(ids.workProgress, 'Rewrite onboarding', null, 1000, fresh).lastInsertRowid;
    ids.workCompletedCard = card.run(ids.workCompleted, 'Fix billing bug', daysFromToday(-9), 1000, fresh).lastInsertRowid;
    ids.workArchivedCard = card.run(ids.workArchived, 'Old spike', null, 1000, fresh).lastInsertRowid;

    ({ buildTaskSnapshot } = await import('../server/src/lib/task-snapshot.js'));
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts open vs done-like, excluding done/completed/archived columns from open', () => {
    const snap = buildTaskSnapshot({ db });
    // Open = 8: LIFE (overdue, due today, undated, stale, doing) + WORK (overdue, future, doing)
    assert.equal(snap.totals.open, 8);
    // Done-like = 3: LIFE Done + WORK Completed + WORK Archived
    assert.equal(snap.totals.done, 3);
    assert.equal(snap.totals.in_progress, 2);
  });

  it('classifies columns conservatively by normalized name', () => {
    const snap = buildTaskSnapshot({ db });
    const cols = snap.boards.flatMap((b) => b.columns);
    const kindOf = (name) => cols.find((c) => c.name === name)?.kind;
    assert.equal(kindOf('Done'), 'done');
    assert.equal(kindOf('Completed'), 'done');
    assert.equal(kindOf('Archived'), 'done');
    assert.equal(kindOf('Doing'), 'doing');
    assert.equal(kindOf('In Progress'), 'doing');
    assert.equal(kindOf('To do'), 'open');
    assert.equal(kindOf('Backlog'), 'open');
  });

  it('counts overdue, due-today and undated among OPEN cards only', () => {
    const snap = buildTaskSnapshot({ db });
    // Overdue open = Renew passport + Ship Q3 report. The done "Pay rent" and
    // completed "Fix billing bug" are past-due but MUST NOT count.
    assert.equal(snap.totals.overdue, 2);
    assert.equal(snap.totals.due_today, 1);
    // Undated open = Buy running shoes, Sort the garage, Read Atomic Habits,
    // Rewrite onboarding.
    assert.equal(snap.totals.undated, 4);
  });

  it('counts stale open cards by last update age', () => {
    const snap = buildTaskSnapshot({ db, staleDays: 14 });
    assert.equal(snap.totals.stale, 1);
    const stale = snap.cards.find((c) => c.id === ids.staleCard);
    assert.ok(stale, 'stale card must be present in the snapshot');
    assert.equal(stale.stale, true);
    assert.ok(stale.stale_days > 365, 'stale_days should reflect real age');
  });

  it('exposes board/column/card ids and titles the coach can act on', () => {
    const snap = buildTaskSnapshot({ db });
    const overdue = snap.cards.find((c) => c.id === ids.overdueCard);
    assert.equal(overdue.title, 'Renew passport');
    assert.equal(overdue.board_id, ids.life);
    assert.equal(overdue.board_name, 'LIFE');
    assert.equal(overdue.column_id, ids.lifeTodo);
    assert.equal(overdue.column_name, 'To do');
    assert.equal(overdue.status, 'overdue');
  });

  it('never includes done-like cards in the actionable card list', () => {
    const snap = buildTaskSnapshot({ db });
    const listed = snap.cards.map((c) => c.id);
    assert.ok(!listed.includes(ids.doneCard), 'done card must not be listed');
    assert.ok(!listed.includes(ids.workCompletedCard), 'completed card must not be listed');
    assert.ok(!listed.includes(ids.workArchivedCard), 'archived card must not be listed');
  });

  it('prioritizes overdue, then due-today, then doing', () => {
    const snap = buildTaskSnapshot({ db });
    const statuses = snap.cards.map((c) => c.status);
    const firstIdx = (s) => statuses.indexOf(s);
    assert.equal(statuses[0], 'overdue');
    assert.ok(firstIdx('overdue') < firstIdx('due_today'), 'overdue before due_today');
    assert.ok(firstIdx('due_today') < firstIdx('doing'), 'due_today before doing');
    assert.ok(firstIdx('doing') < firstIdx('open'), 'doing before plain open');
  });

  it('does not mutate any task data', () => {
    const before = db.prepare('SELECT id, column_id, title, due_date, updated_at FROM cards ORDER BY id').all();
    buildTaskSnapshot({ db });
    const after = db.prepare('SELECT id, column_id, title, due_date, updated_at FROM cards ORDER BY id').all();
    assert.deepEqual(after, before);
  });

  it('reports per-board counts for LIFE and WORK', () => {
    const snap = buildTaskSnapshot({ db });
    const life = snap.boards.find((b) => b.id === ids.life);
    const work = snap.boards.find((b) => b.id === ids.work);
    assert.equal(life.name, 'LIFE');
    assert.equal(life.counts.open, 5);
    assert.equal(life.counts.overdue, 1);
    assert.equal(work.counts.open, 3);
    assert.equal(work.counts.done, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Bounds — the snapshot must stay prompt-sized without going blind
// ═══════════════════════════════════════════════════════════════════

describe('buildTaskSnapshot - output bounds preserve LIFE and WORK visibility', () => {
  let db, tmpDir, buildTaskSnapshot;
  const ids = {};

  before(async () => {
    const { default: Database } = await import('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-tasksnap-bounds-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    db.pragma('foreign_keys = ON');
    migrate(db);

    const board = db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)');
    const column = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
    const card = db.prepare('INSERT INTO cards (column_id, title, due_date, position) VALUES (?, ?, ?, ?)');

    ids.life = board.run('LIFE', 1000).lastInsertRowid;
    ids.work = board.run('WORK', 2000).lastInsertRowid;
    ids.lifeTodo = column.run(ids.life, 'To do', 1000).lastInsertRowid;
    ids.workTodo = column.run(ids.work, 'To do', 1000).lastInsertRowid;

    // LIFE floods the board with overdue work — the highest-priority bucket.
    for (let i = 0; i < 60; i++) card.run(ids.lifeTodo, `LIFE overdue ${i}`, daysFromToday(-2), 1000 + i);
    // WORK has only quiet undated cards, which would be starved by a naive
    // global top-N ordering.
    for (let i = 0; i < 10; i++) card.run(ids.workTodo, `WORK undated ${i}`, null, 1000 + i);

    ({ buildTaskSnapshot } = await import('../server/src/lib/task-snapshot.js'));
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('caps the card list at maxCards', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 20 });
    assert.ok(snap.cards.length <= 20, `expected <= 20 cards, got ${snap.cards.length}`);
  });

  it('keeps WORK visible even when LIFE floods the priority budget', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 20 });
    const workCards = snap.cards.filter((c) => c.board_id === ids.work);
    assert.ok(workCards.length > 0, 'WORK must not be starved out of the snapshot');
  });

  it('reports truncation honestly instead of silently dropping cards', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 20 });
    assert.equal(snap.truncated, true);
    assert.ok(snap.omitted > 0, 'omitted count must tell the coach what it cannot see');
    // Totals must still describe the WHOLE board, not just the listed slice.
    assert.equal(snap.totals.open, 70);
    assert.equal(snap.totals.overdue, 60);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fair allocation across MANY boards. Two boards hide the bug: with a
// per-board floor of 3, the first boards eat the whole budget and every
// later board goes invisible — the coach then swears a board is empty
// when it is not. Whole-board invisibility must be impossible while the
// budget can afford one card each, and reported out loud when it can't.
// ═══════════════════════════════════════════════════════════════════

describe('buildTaskSnapshot - no board is starved while the budget can afford it', () => {
  let db, tmpDir, buildTaskSnapshot;
  const boardIds = [];

  before(async () => {
    const { default: Database } = await import('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-tasksnap-fair-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    db.pragma('foreign_keys = ON');
    migrate(db);

    const board = db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)');
    const column = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
    const card = db.prepare('INSERT INTO cards (column_id, title, due_date, position) VALUES (?, ?, ?, ?)');

    // 12 boards with open work. Board 0 floods with overdue cards — the
    // highest-priority bucket — and would otherwise swallow the budget.
    for (let b = 0; b < 12; b++) {
      const id = board.run(`BOARD ${b}`, 1000 + b).lastInsertRowid;
      boardIds.push(id);
      const col = column.run(id, 'To do', 1000).lastInsertRowid;
      const n = b === 0 ? 40 : 3;
      for (let i = 0; i < n; i++) {
        card.run(col, `B${b} card ${i}`, b === 0 ? daysFromToday(-2) : null, 1000 + i);
      }
    }
    // A 13th board with NO open cards: it is legitimately absent from the card
    // list and must never be reported as omitted.
    const emptyId = board.run('EMPTY', 9000).lastInsertRowid;
    column.run(emptyId, 'To do', 1000);

    ({ buildTaskSnapshot } = await import('../server/src/lib/task-snapshot.js'));
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('gives every board with open cards at least one slot when maxCards allows it', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 12 });
    const seen = new Set(snap.cards.map((c) => c.board_id));
    const missing = boardIds.filter((id) => !seen.has(id));
    assert.deepEqual(missing, [],
      `every board with open work must be visible when the budget can afford one each; missing: ${missing}`);
    assert.ok(snap.cards.length <= 12);
  });

  it('still gives each board a slot at exactly the break-even budget', () => {
    // maxCards === boards-with-open-cards: the tightest budget that can still
    // afford one card per board. Nothing may be starved here.
    const snap = buildTaskSnapshot({ db, maxCards: 12, perBoardMin: 3 });
    const seen = new Set(snap.cards.map((c) => c.board_id));
    assert.equal(seen.size, 12, 'all 12 boards must appear at break-even');
    assert.equal(snap.omitted_boards.length, 0, 'nothing is board-invisible here');
  });

  it('spends the surplus on priority once every board has its floor', () => {
    // 12 boards × a floor of 3 = 36 slots, so 40 is the first budget with a
    // real surplus to spend on priority.
    const snap = buildTaskSnapshot({ db, maxCards: 40 });
    const seen = new Set(snap.cards.map((c) => c.board_id));
    assert.equal(seen.size, 12, 'no board may drop out when the budget grows');
    // The flooded board has 40 overdue cards; surplus slots are priority-spent,
    // so it must hold the lion's share — global priority still wins the extras.
    const flooded = snap.cards.filter((c) => c.board_id === boardIds[0]);
    assert.ok(flooded.length > 3, `overdue board should win surplus slots, got ${flooded.length}`);
    assert.equal(snap.cards[0].status, 'overdue', 'global priority order is preserved');
  });

  it('names the boards it cannot show when there are more boards than slots', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 5 });
    const seen = new Set(snap.cards.map((c) => c.board_id));
    assert.equal(seen.size, 5, 'a 5-card budget can cover exactly 5 boards');
    // Whole-board invisibility is the one truncation the coach cannot infer
    // from a card list, so it must be reported explicitly.
    assert.equal(snap.omitted_boards.length, 7);
    for (const b of snap.omitted_boards) {
      assert.ok(Number.isInteger(b.id), 'omitted board must carry its id');
      assert.match(b.name, /^BOARD \d+$/, 'omitted board must carry its name');
      assert.ok(b.open > 0, 'omitted board must say how much open work is hidden');
      assert.ok(!seen.has(b.id), 'a listed board is not omitted');
    }
    assert.equal(snap.truncated, true);
  });

  it('never reports a board with no open cards as omitted', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 5 });
    const names = snap.omitted_boards.map((b) => b.name);
    assert.ok(!names.includes('EMPTY'), 'an empty board is not hidden work');
  });

  it('reports no omitted boards when everything fits', () => {
    const snap = buildTaskSnapshot({ db, maxCards: 500 });
    assert.deepEqual(snap.omitted_boards, []);
    assert.equal(snap.truncated, false);
    assert.equal(snap.omitted, 0);
  });
});
