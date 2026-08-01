// Read-only synthesis of board reality for the coach.
//
// The coach must know what's actually on the boards BEFORE it asks the user
// what matters today — otherwise the "Daily Command Meeting" degenerates into
// a questionnaire that ignores the work already captured.
//
// Two hard rules:
//   1. NEVER mutate. This module only reads. Task changes go through the
//      normal card routes, with the user's explicit confirmation.
//   2. Stay bounded but never go blind. The output lands in a system prompt,
//      so the card list is capped — but the TOTALS always describe the whole
//      board, every board keeps a minimum slice of the budget, and truncation
//      is reported honestly via `truncated`/`omitted`.
//
// `db` is injected rather than imported: importing ../db.js has the side
// effect of opening the live database and applying migrations, which would
// make merely importing this module (in a test, say) touch real user data.

import { todayISO } from './dates.js';

// Column classification is deliberately CONSERVATIVE — a normalized exact
// name match, no fuzzy contains. Mislabeling a column as "done" would hide
// real open work from the user, which is the one failure we can't accept.
const DONE_NAMES = new Set(['done', 'completed', 'complete', 'archive', 'archived']);
const DOING_NAMES = new Set(['doing', 'in progress', 'in-progress', 'in_progress', 'wip']);

function normalize(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function columnKind(name) {
  const n = normalize(name);
  if (DONE_NAMES.has(n)) return 'done';
  if (DOING_NAMES.has(n)) return 'doing';
  return 'open';
}

// Priority ranks. Lower sorts first: real deadline pressure outranks
// work-in-flight, which outranks the undifferentiated backlog.
const RANK = { overdue: 0, due_today: 1, doing: 2, open: 3 };

function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00`).getTime();
  const b = new Date(`${toIso}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function ageInDays(updatedAt, today) {
  if (!updatedAt) return 0;
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return 0;
  const now = new Date(`${today}T23:59:59`).getTime();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

function emptyCounts() {
  return { total: 0, open: 0, done: 0, in_progress: 0, overdue: 0, due_today: 0, undated: 0, stale: 0 };
}

/**
 * @param {object}  opts
 * @param {object}  opts.db         better-sqlite3 handle (required — see note above)
 * @param {string}  [opts.today]    YYYY-MM-DD; defaults to the server's local today
 * @param {number}  [opts.maxCards] cap on the returned card list
 * @param {number}  [opts.perBoardMin] floor of slots each board keeps, so one
 *                                  busy board can't starve the others
 * @param {number}  [opts.staleDays] open + untouched for this long = stale
 */
export function buildTaskSnapshot({ db, today = todayISO(), maxCards = 40, perBoardMin = 3, staleDays = 14 } = {}) {
  if (!db) throw new Error('buildTaskSnapshot requires a db handle');

  const boardRows = db.prepare('SELECT id, name, position FROM boards ORDER BY position, id').all();
  const columnRows = db.prepare('SELECT id, board_id, name, position FROM columns ORDER BY board_id, position, id').all();
  const cardRows = db.prepare(`
    SELECT c.id, c.column_id, c.title, c.due_date, c.updated_at, c.position
    FROM cards c ORDER BY c.column_id, c.position, c.id
  `).all();

  const boardById = new Map();
  for (const b of boardRows) {
    boardById.set(b.id, { id: b.id, name: b.name, columns: [], counts: emptyCounts() });
  }
  const columnById = new Map();
  for (const col of columnRows) {
    const kind = columnKind(col.name);
    const entry = { id: col.id, name: col.name, kind, board_id: col.board_id };
    columnById.set(col.id, entry);
    boardById.get(col.board_id)?.columns.push({ id: col.id, name: col.name, kind });
  }

  const totals = { ...emptyCounts(), boards: boardRows.length, columns: columnRows.length };
  const candidates = [];

  for (const card of cardRows) {
    const col = columnById.get(card.column_id);
    if (!col) continue;                       // orphan guard; FK makes this unreachable
    const board = boardById.get(col.board_id);
    if (!board) continue;

    totals.total++;
    board.counts.total++;

    if (col.kind === 'done') {
      totals.done++;
      board.counts.done++;
      continue;                               // done-like work is counted, never listed
    }

    totals.open++;
    board.counts.open++;

    let status = col.kind === 'doing' ? 'doing' : 'open';
    if (col.kind === 'doing') {
      totals.in_progress++;
      board.counts.in_progress++;
    }

    let overdueBy = null;
    if (card.due_date) {
      const delta = daysBetween(today, card.due_date);
      if (delta < 0) {
        status = 'overdue';                   // deadline pressure outranks column
        overdueBy = -delta;
        totals.overdue++;
        board.counts.overdue++;
      } else if (delta === 0) {
        status = 'due_today';
        totals.due_today++;
        board.counts.due_today++;
      }
    } else {
      totals.undated++;
      board.counts.undated++;
    }

    const staleDaysActual = ageInDays(card.updated_at, today);
    const isStale = staleDaysActual >= staleDays;
    if (isStale) {
      totals.stale++;
      board.counts.stale++;
    }

    candidates.push({
      id: card.id,
      title: card.title,
      board_id: board.id,
      board_name: board.name,
      column_id: col.id,
      column_name: col.name,
      status,
      in_progress_column: col.kind === 'doing',
      due_date: card.due_date || null,
      overdue_by_days: overdueBy,
      stale: isStale,
      stale_days: staleDaysActual,
      _pos: card.position,
    });
  }

  candidates.sort(compareCards);

  // Budget, spent in three passes. The order matters: a naive "floor per board"
  // loop hands the first boards `perBoardMin` slots each and leaves nothing for
  // the rest, so with more boards than budget/floor, whole boards vanish and
  // the coach confidently reports an empty board that isn't.
  //   1. BREADTH — one card per board with open work, most urgent board first.
  //      While the budget can afford one each, no board can be invisible.
  //   2. FLOOR   — raise each represented board towards perBoardMin.
  //   3. DEPTH   — spend whatever is left strictly by global priority.
  const byBoard = new Map();
  for (const c of candidates) {
    if (!byBoard.has(c.board_id)) byBoard.set(c.board_id, []);
    byBoard.get(c.board_id).push(c);      // candidates are already priority-sorted
  }
  // Board order = urgency of each board's best card, so when slots are scarcer
  // than boards it's the quietest boards that fall off, never the loudest.
  const boardOrder = [...byBoard.keys()]
    .sort((a, b) => compareCards(byBoard.get(a)[0], byBoard.get(b)[0]));

  const selected = [];
  const taken = new Set();
  const take = (c) => {
    selected.push(c);
    taken.add(c.id);
  };

  if (maxCards > 0) {
    for (const bid of boardOrder) {                       // 1. breadth
      if (selected.length >= maxCards) break;
      take(byBoard.get(bid)[0]);
    }
    for (const bid of boardOrder) {                       // 2. floor
      if (selected.length >= maxCards) break;
      for (const c of byBoard.get(bid).slice(0, perBoardMin)) {
        if (selected.length >= maxCards) break;
        if (!taken.has(c.id)) take(c);
      }
    }
    for (const c of candidates) {                         // 3. depth
      if (selected.length >= maxCards) break;
      if (!taken.has(c.id)) take(c);
    }
  }
  selected.sort(compareCards);

  // A board with open work and zero listed cards is the one omission the coach
  // cannot infer from the card list, so name it rather than let it read as empty.
  const shown = new Set(selected.map((c) => c.board_id));
  const omittedBoards = boardOrder
    .filter((bid) => !shown.has(bid))
    .map((bid) => {
      const b = boardById.get(bid);
      return { id: b.id, name: b.name, open: b.counts.open };
    });

  return {
    generated_for: today,
    totals,
    boards: [...boardById.values()],
    cards: selected.map(({ _pos, ...c }) => c),
    truncated: selected.length < candidates.length,
    omitted: candidates.length - selected.length,
    omitted_boards: omittedBoards,
  };
}

function compareCards(a, b) {
  const rank = RANK[a.status] - RANK[b.status];
  if (rank !== 0) return rank;
  // Within a rank: soonest deadline first, undated last, then board/card order.
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  if (a.board_id !== b.board_id) return a.board_id - b.board_id;
  if (a._pos !== b._pos) return (a._pos ?? 0) - (b._pos ?? 0);
  return a.id - b.id;
}
