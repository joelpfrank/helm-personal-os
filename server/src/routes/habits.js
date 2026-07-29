import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, requireString, optionalString, optionalNumber,
  optionalColor, rejectUnknownKeys,
} from '../lib/validate.js';
import {
  todayISO, isoDayOfWeek, parseDaysOfWeek, isScheduledOn, daysAgoISO,
} from '../lib/dates.js';

const router = Router();

const sql = {
  listAll: db.prepare(`
    SELECT id, name, description, emoji, color, goal_quantity, unit,
           days_of_week, time_of_day, category, position, archived_at, created_at, updated_at
    FROM habits
    ORDER BY archived_at IS NOT NULL, position, id
  `),
  listActive: db.prepare(`
    SELECT id, name, description, emoji, color, goal_quantity, unit,
           days_of_week, time_of_day, category, position, archived_at, created_at, updated_at
    FROM habits
    WHERE archived_at IS NULL
    ORDER BY position, id
  `),
  get: db.prepare(`
    SELECT id, name, description, emoji, color, goal_quantity, unit,
           days_of_week, time_of_day, category, position, archived_at, created_at, updated_at
    FROM habits WHERE id = ?
  `),
  byName: db.prepare(`
    SELECT id FROM habits WHERE LOWER(name) = LOWER(?) AND archived_at IS NULL
  `),
  insert: db.prepare(`
    INSERT INTO habits (name, description, emoji, color, goal_quantity, unit, days_of_week, time_of_day, category, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM habits WHERE id = ?'),
  archive: db.prepare("UPDATE habits SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND archived_at IS NULL"),
  unarchive: db.prepare('UPDATE habits SET archived_at = NULL WHERE id = ?'),

  insertLog: db.prepare(`
    INSERT INTO habit_logs (habit_id, date, quantity, note)
    VALUES (?, ?, ?, ?)
  `),
  deleteLog: db.prepare('DELETE FROM habit_logs WHERE id = ?'),
  logsForHabitOnDate: db.prepare(`
    SELECT id, habit_id, date, quantity, note, logged_at
    FROM habit_logs WHERE habit_id = ? AND date = ?
    ORDER BY logged_at
  `),
  logsForHabitInRange: db.prepare(`
    SELECT id, habit_id, date, quantity, note, logged_at
    FROM habit_logs WHERE habit_id = ? AND date BETWEEN ? AND ?
    ORDER BY date, logged_at
  `),
  sumByDate: db.prepare(`
    SELECT date, SUM(quantity) AS quantity, COUNT(*) AS log_count
    FROM habit_logs WHERE habit_id = ? AND date BETWEEN ? AND ?
    GROUP BY date
  `),
  todayQuantityForHabit: db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS q
    FROM habit_logs WHERE habit_id = ? AND date = ?
  `),
  lastLogOnDate: db.prepare(`
    SELECT id, habit_id, date, quantity, note, logged_at
    FROM habit_logs WHERE habit_id = ? AND date = ?
    ORDER BY logged_at DESC, id DESC LIMIT 1
  `),

  // ----- explicit tri-state outcomes -----
  outcomeGet: db.prepare('SELECT status FROM habit_outcomes WHERE habit_id = ? AND date = ?'),
  outcomeUpsert: db.prepare(`
    INSERT INTO habit_outcomes (habit_id, date, status) VALUES (?, ?, ?)
    ON CONFLICT(habit_id, date) DO UPDATE SET status = excluded.status
  `),
  outcomeDelete: db.prepare('DELETE FROM habit_outcomes WHERE habit_id = ? AND date = ?'),
  outcomesInRange: db.prepare(`
    SELECT date, status FROM habit_outcomes
    WHERE habit_id = ? AND date BETWEEN ? AND ?
  `),
};

const OUTCOME_STATUSES = ['success', 'failed'];

// The single source of truth for tri-state status. An EXPLICIT outcome
// (success|failed) always wins. Otherwise it is derived from quantity: enough
// quantity → 'success', anything less (including zero) → 'unspecified'. A blank
// day is NEVER 'failed' — absence means Unspecified, not a miss.
function effectiveStatus(explicit, quantity, goal) {
  if (explicit === 'success' || explicit === 'failed') return explicit;
  if (goal > 0 && quantity >= goal) return 'success';
  return 'unspecified';
}

function validateDaysOfWeek(value) {
  const parsed = parseDaysOfWeek(value);
  if (parsed.length === 0) throw errors.validation('days_of_week must include at least one day (1=Mon…7=Sun)');
  return [...new Set(parsed)].sort((a, b) => a - b).join(',');
}

const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'night', 'anytime'];
const CATEGORY_MAX = 50;

// '' / null → 'anytime'; otherwise must be one of TIMES_OF_DAY (case-insensitive).
function validateTimeOfDay(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '') return 'anytime';
  if (!TIMES_OF_DAY.includes(v)) {
    throw errors.validation(`time_of_day must be one of ${TIMES_OF_DAY.join('|')}`);
  }
  return v;
}

// Free text, trimmed; '' means uncategorized.
function validateCategory(value) {
  const v = String(value ?? '').trim();
  if (v.length > CATEGORY_MAX) throw errors.validation(`category must be at most ${CATEGORY_MAX} characters`);
  return v;
}

// ----- habits CRUD -----

router.get('/', (req, res) => {
  const include = String(req.query.include || '');
  res.json(include === 'archived' ? sql.listAll.all() : sql.listActive.all());
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, [
      'name', 'description', 'emoji', 'color', 'goal_quantity', 'unit', 'days_of_week',
      'time_of_day', 'category', 'position',
    ]);
    const name = requireString(req.body, 'name');
    if (sql.byName.get(name)) throw errors.conflict(`habit "${name}" already exists`);
    const description = optionalString(req.body, 'description') ?? '';
    const emoji = optionalString(req.body, 'emoji') ?? '';
    const color = optionalColor(req.body, 'color') ?? null;
    const goal = optionalNumber(req.body, 'goal_quantity');
    if (goal != null && goal <= 0) throw errors.validation('goal_quantity must be > 0');
    const unit = optionalString(req.body, 'unit') ?? '';
    const dowRaw = optionalString(req.body, 'days_of_week');
    const days = dowRaw === undefined ? '1,2,3,4,5,6,7' : validateDaysOfWeek(dowRaw);
    const todRaw = optionalString(req.body, 'time_of_day');
    const timeOfDay = todRaw === undefined ? 'anytime' : validateTimeOfDay(todRaw);
    const catRaw = optionalString(req.body, 'category');
    const category = catRaw === undefined ? '' : validateCategory(catRaw);
    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.listActive.all()) : positionRaw;
    const info = sql.insert.run(name, description, emoji, color, goal ?? 1, unit, days, timeOfDay, category, position);
    res.status(201).json(sql.get.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

// GET /api/habits/calendar?from=&to= → macro grid view: every active
// habit × every day in the range, with scheduled/met/ratio per cell.
router.get('/calendar', (req, res, next) => {
  try {
    const to = String(req.query.to || todayISO());
    const defaultFrom = daysAgoISO(29);
    const from = String(req.query.from || defaultFrom);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw errors.validation('to must be YYYY-MM-DD');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw errors.validation('from must be YYYY-MM-DD');
    if (from > to) throw errors.validation('from must be <= to');

    const dates = [];
    for (let d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
      dates.push(todayISO(d));
    }

    const habits = sql.listActive.all();
    const out = habits.map((h) => {
      const days = parseDaysOfWeek(h.days_of_week);
      const sums = sql.sumByDate.all(h.id, from, to);
      const sumByDate = new Map(sums.map((r) => [r.date, r.quantity]));
      const outcomes = sql.outcomesInRange.all(h.id, from, to);
      const outcomeByDate = new Map(outcomes.map((r) => [r.date, r.status]));
      const entries = dates.map((date) => {
        const d = new Date(date + 'T00:00:00');
        const dow = d.getDay() === 0 ? 7 : d.getDay();
        const scheduled = days.includes(dow);
        const quantity = sumByDate.get(date) || 0;
        const ratio = h.goal_quantity > 0 ? Math.min(1, quantity / h.goal_quantity) : 0;
        const outcome = outcomeByDate.get(date) || null;
        const effective = effectiveStatus(outcome, quantity, h.goal_quantity);
        // met follows the effective status so the grid distinguishes an
        // explicit failure from a genuinely blank (unspecified) day.
        const met = scheduled && effective === 'success';
        return { date, scheduled, quantity, ratio, outcome, effective_status: effective, met };
      });
      return {
        id: h.id,
        name: h.name,
        color: h.color,
        goal_quantity: h.goal_quantity,
        unit: h.unit,
        days_of_week: h.days_of_week,
        time_of_day: h.time_of_day,
        category: h.category,
        entries,
      };
    });

    res.json({ from, to, dates, habits: out });
  } catch (e) { next(e); }
});

router.get('/today', (_req, res) => {
  const date = todayISO();
  const dow = isoDayOfWeek();
  const habits = sql.listActive.all();
  const scheduled = habits.filter((h) => parseDaysOfWeek(h.days_of_week).includes(dow));
  const out = scheduled.map((h) => {
    const today_quantity = sql.todayQuantityForHabit.get(h.id, date).q;
    const row = sql.outcomeGet.get(h.id, date);
    const outcome = row ? row.status : null;
    const effective = effectiveStatus(outcome, today_quantity, h.goal_quantity);
    return {
      ...h,
      today_quantity,
      progress: h.goal_quantity > 0 ? Math.min(1, today_quantity / h.goal_quantity) : 0,
      outcome,
      effective_status: effective,
      // completed follows the EFFECTIVE status: an explicit 'failed' is never
      // completed even if quantity logs exist; an explicit 'success' is.
      completed: effective === 'success',
    };
  });
  res.json({ date, day_of_week: dow, habits: out });
});

router.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const habit = sql.get.get(id);
    if (!habit) throw errors.notFound('habit not found');
    res.json(habit);
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, [
      'name', 'description', 'emoji', 'color', 'goal_quantity', 'unit',
      'days_of_week', 'time_of_day', 'category', 'position', 'archived',
    ]);
    const updates = [];
    const vals = [];

    const nameRaw = optionalString(req.body, 'name');
    if (nameRaw !== undefined) {
      if (!nameRaw || !nameRaw.trim()) throw errors.validation('name must be non-empty');
      const dup = sql.byName.get(nameRaw.trim());
      if (dup && dup.id !== id) throw errors.conflict(`habit "${nameRaw.trim()}" already exists`);
      updates.push('name = ?'); vals.push(nameRaw.trim());
    }
    const descRaw = optionalString(req.body, 'description');
    if (descRaw !== undefined) { updates.push('description = ?'); vals.push(descRaw ?? ''); }
    const emojiRaw = optionalString(req.body, 'emoji');
    if (emojiRaw !== undefined) { updates.push('emoji = ?'); vals.push(emojiRaw ?? ''); }
    const colorRaw = optionalColor(req.body, 'color');
    if (colorRaw !== undefined) { updates.push('color = ?'); vals.push(colorRaw); }
    const goalRaw = optionalNumber(req.body, 'goal_quantity');
    if (goalRaw !== undefined) {
      if (goalRaw == null || goalRaw <= 0) throw errors.validation('goal_quantity must be > 0');
      updates.push('goal_quantity = ?'); vals.push(goalRaw);
    }
    const unitRaw = optionalString(req.body, 'unit');
    if (unitRaw !== undefined) { updates.push('unit = ?'); vals.push(unitRaw ?? ''); }
    const dowRaw = optionalString(req.body, 'days_of_week');
    if (dowRaw !== undefined) {
      updates.push('days_of_week = ?');
      vals.push(validateDaysOfWeek(dowRaw));
    }
    const todRaw = optionalString(req.body, 'time_of_day');
    if (todRaw !== undefined) { updates.push('time_of_day = ?'); vals.push(validateTimeOfDay(todRaw)); }
    const catRaw = optionalString(req.body, 'category');
    if (catRaw !== undefined) { updates.push('category = ?'); vals.push(validateCategory(catRaw)); }
    const positionRaw = optionalNumber(req.body, 'position');
    if (positionRaw !== undefined) {
      if (positionRaw == null) throw errors.validation('position cannot be null');
      updates.push('position = ?'); vals.push(positionRaw);
    }
    if ('archived' in (req.body || {})) {
      const archived = req.body.archived;
      if (typeof archived !== 'boolean') throw errors.validation('archived must be boolean');
      (archived ? sql.archive : sql.unarchive).run(id);
    }

    if (updates.length) {
      vals.push(id);
      const info = db.prepare(`UPDATE habits SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      if (info.changes === 0) throw errors.notFound('habit not found');
    } else {
      const exists = sql.get.get(id);
      if (!exists) throw errors.notFound('habit not found');
    }
    res.json(sql.get.get(id));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('habit not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ----- logs -----

// POST /api/habits/:id/log  body: { date?, quantity?, note? }
router.post('/:id/log', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    if (!sql.get.get(habitId)) throw errors.notFound('habit not found');
    rejectUnknownKeys(req.body, ['date', 'quantity', 'note']);
    const dateRaw = optionalString(req.body, 'date');
    const date = dateRaw && dateRaw.trim() ? dateRaw.trim() : todayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('date must be YYYY-MM-DD');
    const qty = optionalNumber(req.body, 'quantity');
    if (qty != null && qty <= 0) throw errors.validation('quantity must be > 0');
    const note = optionalString(req.body, 'note') ?? '';
    const info = sql.insertLog.run(habitId, date, qty ?? 1, note);
    res.status(201).json({
      id: info.lastInsertRowid,
      habit_id: habitId,
      date,
      quantity: qty ?? 1,
      note,
    });
  } catch (e) { next(e); }
});

// ----- explicit tri-state outcomes -----

// Build the outcome view for one habit/date: the explicit outcome (or null),
// the effective status (explicit wins, else quantity-derived), the quantity,
// and completed (true only when the EFFECTIVE status is success).
function outcomeView(habit, date) {
  const row = sql.outcomeGet.get(habit.id, date);
  const explicit = row ? row.status : null;
  const quantity = sql.todayQuantityForHabit.get(habit.id, date).q;
  const effective = effectiveStatus(explicit, quantity, habit.goal_quantity);
  return {
    habit_id: habit.id,
    date,
    outcome: explicit,
    effective_status: effective,
    quantity,
    goal_quantity: habit.goal_quantity,
    completed: effective === 'success',
  };
}

function outcomeDate(raw, field = 'date') {
  const v = raw == null ? '' : String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw errors.validation(`${field} must be YYYY-MM-DD`);
  return v;
}

// GET /api/habits/:id/outcome?date=YYYY-MM-DD — read tri-state for one day.
router.get('/:id/outcome', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    const habit = sql.get.get(habitId);
    if (!habit) throw errors.notFound('habit not found');
    const date = outcomeDate(req.query.date || todayISO());
    res.json(outcomeView(habit, date));
  } catch (e) { next(e); }
});

// PUT /api/habits/:id/outcome  body: { date?, status } — set an explicit
// Achieved (success) or Not achieved (failed) outcome. Upserts on habit+date.
// Does NOT touch quantity logs.
router.put('/:id/outcome', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    const habit = sql.get.get(habitId);
    if (!habit) throw errors.notFound('habit not found');
    rejectUnknownKeys(req.body, ['date', 'status']);
    const dateRaw = optionalString(req.body, 'date');
    const date = outcomeDate(dateRaw && dateRaw.trim() ? dateRaw : todayISO());
    const status = requireString(req.body, 'status');
    if (!OUTCOME_STATUSES.includes(status)) {
      throw errors.validation(`status must be one of ${OUTCOME_STATUSES.join('|')} (clear via DELETE for unspecified)`);
    }
    sql.outcomeUpsert.run(habitId, date, status);
    res.json(outcomeView(habit, date));
  } catch (e) { next(e); }
});

// DELETE /api/habits/:id/outcome?date=YYYY-MM-DD — clear an explicit outcome
// back to Unspecified (removes the row; quantity logs are preserved).
router.delete('/:id/outcome', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    const habit = sql.get.get(habitId);
    if (!habit) throw errors.notFound('habit not found');
    const date = outcomeDate(req.query.date || todayISO());
    sql.outcomeDelete.run(habitId, date);
    res.json(outcomeView(habit, date));
  } catch (e) { next(e); }
});

// GET /api/habits/:id/logs?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/:id/logs', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    if (!sql.get.get(habitId)) throw errors.notFound('habit not found');
    const to = String(req.query.to || todayISO());
    const from = String(req.query.from || daysAgoISO(89));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw errors.validation('to must be YYYY-MM-DD');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw errors.validation('from must be YYYY-MM-DD');
    res.json(sql.logsForHabitInRange.all(habitId, from, to));
  } catch (e) { next(e); }
});

// GET /api/habits/:id/stats — current streak, longest streak, completion %, last 90d heatmap data
router.get('/:id/stats', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    const habit = sql.get.get(habitId);
    if (!habit) throw errors.notFound('habit not found');

    const today = todayISO();
    const from = daysAgoISO(89);
    const days = parseDaysOfWeek(habit.days_of_week);
    const sums = sql.sumByDate.all(habitId, from, today);
    const sumByDate = new Map(sums.map((r) => [r.date, r.quantity]));
    const outcomes = sql.outcomesInRange.all(habitId, from, today);
    const outcomeByDate = new Map(outcomes.map((r) => [r.date, r.status]));

    // Walk every day in [from, today], decide scheduled, decide effective status.
    const heatmap = [];
    let scheduledCount = 0;
    let successCount = 0;   // effective 'success' on a scheduled day
    let failedCount = 0;    // explicit 'failed' on a scheduled day
    let unspecifiedCount = 0; // scheduled but neither — genuinely blank
    for (let d = new Date(from + 'T00:00:00'); d <= new Date(today + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
      const iso = todayISO(d);
      const dow = isoDayOfWeek(d);
      const scheduled = days.includes(dow);
      const qty = sumByDate.get(iso) || 0;
      const outcome = outcomeByDate.get(iso) || null;
      const effective = effectiveStatus(outcome, qty, habit.goal_quantity);
      const met = scheduled && effective === 'success';
      const ratio = habit.goal_quantity > 0 ? Math.min(1, qty / habit.goal_quantity) : 0;
      heatmap.push({ date: iso, scheduled, quantity: qty, ratio, outcome, effective_status: effective, met });
      if (scheduled) {
        scheduledCount++;
        if (effective === 'success') successCount++;
        else if (effective === 'failed') failedCount++;
        else unspecifiedCount++;
      }
    }

    // Current streak: walk backward from today through scheduled days
    // (skipping non-scheduled days), counting consecutive successes. Any
    // non-success scheduled day (explicit failed OR unspecified) ends it.
    let currentStreak = 0;
    for (let i = heatmap.length - 1; i >= 0; i--) {
      const h = heatmap[i];
      if (!h.scheduled) continue;
      if (h.met) currentStreak++;
      else break;
    }

    // Longest streak in this window.
    let longestStreak = 0;
    let run = 0;
    for (const h of heatmap) {
      if (!h.scheduled) continue;
      if (h.met) { run++; longestStreak = Math.max(longestStreak, run); }
      else { run = 0; }
    }

    // resolved = days with an explicit judgement (success or failed). Completion
    // rate is success / resolved, so genuinely blank (unspecified) days are NOT
    // silently counted as misses. If nothing is resolved yet, rate is 0.
    const resolvedCount = successCount + failedCount;
    const completionRate = resolvedCount > 0 ? successCount / resolvedCount : 0;

    res.json({
      habit_id: habit.id,
      name: habit.name,
      from,
      to: today,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      scheduled_days: scheduledCount,
      // met_days kept for backward compatibility — now equals success_days.
      met_days: successCount,
      success_days: successCount,
      failed_days: failedCount,
      unspecified_days: unspecifiedCount,
      resolved_days: resolvedCount,
      // completion_rate is success / resolved (blank days excluded), NOT
      // success / scheduled. This is a deliberate semantic change so blank
      // days are never treated as failures.
      completion_rate: completionRate,
      heatmap,
    });
  } catch (e) { next(e); }
});

// DELETE /api/habits/:id/log/last?date=YYYY-MM-DD — undo the most recent
// log for this habit on this date (defaults to today). 404 if nothing to undo.
router.delete('/:id/log/last', (req, res, next) => {
  try {
    const habitId = intParam(req.params.id, 'id');
    if (!sql.get.get(habitId)) throw errors.notFound('habit not found');
    const dateRaw = String(req.query.date || todayISO());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) throw errors.validation('date must be YYYY-MM-DD');
    const last = sql.lastLogOnDate.get(habitId, dateRaw);
    if (!last) throw errors.notFound(`no log to undo for ${dateRaw}`);
    sql.deleteLog.run(last.id);
    res.json({ ok: true, deleted: last });
  } catch (e) { next(e); }
});

// Delete a single log row (undo).
router.delete('/log/:logId', (req, res, next) => {
  try {
    const logId = intParam(req.params.logId, 'logId');
    const info = sql.deleteLog.run(logId);
    if (info.changes === 0) throw errors.notFound('log not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
