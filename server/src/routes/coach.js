import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, requireString, optionalString, optionalNumber, optionalInt, rejectUnknownKeys,
} from '../lib/validate.js';
import { todayISO, isoDayOfWeek } from '../lib/dates.js';
import { validateCoachingProfile, mergeProfile } from '../lib/coaching-profile.js';
import { buildTaskSnapshot } from '../lib/task-snapshot.js';
import { middayPending, isValidHHMM } from '../lib/cadence.js';

const router = Router();

const HORIZONS = new Set(['vision', 'year', 'quarter', 'month', 'week']);
const STATUSES = new Set(['active', 'done', 'dropped', 'paused']);
const LINK_KINDS = new Set(['habit', 'card', 'routine', 'event', 'food_target', 'workout', 'module', 'module_item']);
const CHECKIN_KINDS = new Set(['morning', 'midday', 'evening', 'weekly', 'biweekly_vision']);

const sql = {
  // ---- vision ----
  visionGet: db.prepare(`
    SELECT id, north_star, identity_statement, core_values, last_reviewed_at, updated_at
    FROM vision WHERE id = 1
  `),
  markVisionReviewed: db.prepare(
    "UPDATE vision SET last_reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1",
  ),

  // ---- goals ----
  goalGet: db.prepare(`
    SELECT id, parent_id, title, description, horizon, status, target_date,
           success_criteria, position, created_at, updated_at, completed_at
    FROM goals WHERE id = ?
  `),
  goalsList: db.prepare(`
    SELECT id, parent_id, title, description, horizon, status, target_date,
           success_criteria, position, created_at, updated_at, completed_at
    FROM goals
    ORDER BY horizon, position, id
  `),
  goalsByStatus: db.prepare(`
    SELECT id, parent_id, title, description, horizon, status, target_date,
           success_criteria, position, created_at, updated_at, completed_at
    FROM goals WHERE status = ?
    ORDER BY horizon, position, id
  `),
  goalInsert: db.prepare(`
    INSERT INTO goals (parent_id, title, description, horizon, status,
                       target_date, success_criteria, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  goalDelete: db.prepare('DELETE FROM goals WHERE id = ?'),
  goalComplete: db.prepare(
    "UPDATE goals SET status = 'done', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ),
  goalSiblings: db.prepare(`
    SELECT id, position FROM goals
    WHERE COALESCE(parent_id, 0) = COALESCE(?, 0)
    ORDER BY position, id
  `),

  // ---- obstacles ----
  obstaclesForGoal: db.prepare(`
    SELECT id, goal_id, obstacle, if_then, created_at
    FROM goal_obstacles WHERE goal_id = ? ORDER BY id
  `),
  obstacleInsert: db.prepare(`
    INSERT INTO goal_obstacles (goal_id, obstacle, if_then) VALUES (?, ?, ?)
  `),
  obstacleDelete: db.prepare('DELETE FROM goal_obstacles WHERE id = ?'),

  // ---- links ----
  linksForGoal: db.prepare(`
    SELECT id, goal_id, kind, target_id, notes, created_at
    FROM goal_links WHERE goal_id = ? ORDER BY id
  `),
  linkInsert: db.prepare(`
    INSERT INTO goal_links (goal_id, kind, target_id, notes) VALUES (?, ?, ?, ?)
  `),
  linkDelete: db.prepare('DELETE FROM goal_links WHERE id = ?'),

  // ---- check-ins ----
  checkinList: db.prepare(`
    SELECT id, kind, date, payload, coach_summary, created_at
    FROM check_ins
    WHERE (? IS NULL OR kind = ?)
      AND date BETWEEN ? AND ?
    ORDER BY date DESC, id DESC
  `),
  checkinToday: db.prepare(`
    SELECT id, kind, date, payload, coach_summary, created_at
    FROM check_ins WHERE kind = ? AND date = ?
  `),
  checkinUpsert: db.prepare(`
    INSERT INTO check_ins (kind, date, payload, coach_summary)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(kind, date) DO UPDATE SET
      payload = excluded.payload,
      coach_summary = excluded.coach_summary
  `),
  checkinGet: db.prepare(`
    SELECT id, kind, date, payload, coach_summary, created_at
    FROM check_ins WHERE id = ?
  `),
  checkinUpdate: db.prepare(`
    UPDATE check_ins SET payload = ?, coach_summary = ? WHERE id = ?
  `),
  recentChecks: db.prepare(`
    SELECT id, kind, date, payload, coach_summary
    FROM check_ins WHERE kind IN ('morning','midday','evening')
    ORDER BY date DESC, id DESC LIMIT ?
  `),
  lastCheckOfKind: db.prepare(`
    SELECT id, kind, date, payload, coach_summary, created_at
    FROM check_ins WHERE kind = ? ORDER BY date DESC, id DESC LIMIT 1
  `),

  // ---- settings ----
  settingsGet: db.prepare(`
    SELECT morning_enabled, morning_time, midday_enabled, midday_time,
           evening_enabled, evening_time,
           weekly_enabled, weekly_dow, vision_review_interval_days, coaching_profile, updated_at
    FROM coach_settings WHERE id = 1
  `),
  getCoachingProfile: db.prepare('SELECT coaching_profile FROM coach_settings WHERE id = 1'),
  setCoachingProfile: db.prepare(
    "UPDATE coach_settings SET coaching_profile = ? WHERE id = 1",
  ),

  // ---- onboarding counts (drives the first-run setup card) ----
  counts: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM habits)     AS habits,
      (SELECT COUNT(*) FROM goals)      AS goals,
      (SELECT COUNT(*) FROM goal_links) AS links,
      (SELECT COUNT(*) FROM check_ins)  AS checkins
  `),
};

function parseJSON(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// Expose `values` to the API (since the JSON field name is fine; only the
// column name was the SQL keyword problem). One place to remap.
function shapeVision(row) {
  if (!row) return null;
  const { core_values, ...rest } = row;
  return { ...rest, values: core_values || '' };
}

function fullGoal(row) {
  if (!row) return null;
  return {
    ...row,
    obstacles: sql.obstaclesForGoal.all(row.id),
    links: sql.linksForGoal.all(row.id),
  };
}

function decodeCheck(row) {
  if (!row) return null;
  return { ...row, payload: parseJSON(row.payload, {}) };
}

// ---------- vision ----------

router.get('/vision', (_req, res) => {
  res.json(shapeVision(sql.visionGet.get()));
});

router.patch('/vision', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['north_star', 'identity_statement', 'values']);
    const updates = [];
    const vals = [];
    // API still accepts `values` as the JSON key; we map to the actual
    // `core_values` column ("values" being a reserved SQL keyword).
    const colMap = { north_star: 'north_star', identity_statement: 'identity_statement', values: 'core_values' };
    for (const k of ['north_star', 'identity_statement', 'values']) {
      const v = optionalString(req.body, k);
      if (v !== undefined) { updates.push(`${colMap[k]} = ?`); vals.push(v ?? ''); }
    }
    if (updates.length) {
      db.prepare(`UPDATE vision SET ${updates.join(', ')} WHERE id = 1`).run(...vals);
    }
    res.json(shapeVision(sql.visionGet.get()));
  } catch (e) { next(e); }
});

router.post('/vision/mark_reviewed', (_req, res) => {
  sql.markVisionReviewed.run();
  res.json(shapeVision(sql.visionGet.get()));
});

// ---------- goals ----------

router.get('/goals', (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const horizon = req.query.horizon ? String(req.query.horizon) : null;
  let rows = status ? sql.goalsByStatus.all(status) : sql.goalsList.all();
  if (horizon) rows = rows.filter((r) => r.horizon === horizon);
  res.json(rows.map(fullGoal));
});

router.get('/goals/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.goalGet.get(id);
    if (!row) throw errors.notFound('goal not found');
    res.json(fullGoal(row));
  } catch (e) { next(e); }
});

router.post('/goals', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, [
      'parent_id', 'title', 'description', 'horizon', 'status',
      'target_date', 'success_criteria', 'position',
    ]);
    const title = requireString(req.body, 'title');
    const horizon = optionalString(req.body, 'horizon') ?? 'quarter';
    if (!HORIZONS.has(horizon)) throw errors.validation(`horizon must be one of ${[...HORIZONS].join(', ')}`);
    const status = optionalString(req.body, 'status') ?? 'active';
    if (!STATUSES.has(status)) throw errors.validation(`status must be one of ${[...STATUSES].join(', ')}`);
    const parentId = optionalInt(req.body, 'parent_id') ?? null;
    if (parentId != null && !sql.goalGet.get(parentId)) throw errors.notFound(`parent goal ${parentId} not found`);
    const description = optionalString(req.body, 'description') ?? '';
    const targetDate = optionalString(req.body, 'target_date') ?? null;
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw errors.validation('target_date must be YYYY-MM-DD');
    }
    const success = optionalString(req.body, 'success_criteria') ?? '';
    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.goalSiblings.all(parentId)) : positionRaw;
    const info = sql.goalInsert.run(parentId, title, description, horizon, status, targetDate, success, position);
    res.status(201).json(fullGoal(sql.goalGet.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

router.patch('/goals/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const existing = sql.goalGet.get(id);
    if (!existing) throw errors.notFound('goal not found');
    rejectUnknownKeys(req.body, [
      'parent_id', 'title', 'description', 'horizon', 'status',
      'target_date', 'success_criteria', 'position',
    ]);
    const updates = [];
    const vals = [];
    if ('parent_id' in (req.body || {})) {
      const parentId = optionalInt(req.body, 'parent_id');
      if (parentId != null && !sql.goalGet.get(parentId)) throw errors.notFound(`parent goal ${parentId} not found`);
      updates.push('parent_id = ?'); vals.push(parentId);
    }
    const title = optionalString(req.body, 'title');
    if (title !== undefined) {
      if (!title || !title.trim()) throw errors.validation('title must be non-empty');
      updates.push('title = ?'); vals.push(title.trim());
    }
    const description = optionalString(req.body, 'description');
    if (description !== undefined) { updates.push('description = ?'); vals.push(description ?? ''); }
    const horizon = optionalString(req.body, 'horizon');
    if (horizon !== undefined) {
      if (!HORIZONS.has(horizon)) throw errors.validation('bad horizon');
      updates.push('horizon = ?'); vals.push(horizon);
    }
    const status = optionalString(req.body, 'status');
    if (status !== undefined) {
      if (!STATUSES.has(status)) throw errors.validation('bad status');
      updates.push('status = ?'); vals.push(status);
      if (status === 'done') {
        updates.push("completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      } else if (status === 'active') {
        updates.push('completed_at = NULL');
      }
    }
    const targetDate = optionalString(req.body, 'target_date');
    if (targetDate !== undefined) {
      if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw errors.validation('bad target_date');
      updates.push('target_date = ?'); vals.push(targetDate || null);
    }
    const success = optionalString(req.body, 'success_criteria');
    if (success !== undefined) { updates.push('success_criteria = ?'); vals.push(success ?? ''); }
    const positionRaw = optionalNumber(req.body, 'position');
    if (positionRaw !== undefined) { updates.push('position = ?'); vals.push(positionRaw); }
    if (updates.length) {
      vals.push(id);
      db.prepare(`UPDATE goals SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    }
    res.json(fullGoal(sql.goalGet.get(id)));
  } catch (e) { next(e); }
});

router.post('/goals/:id/complete', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (!sql.goalGet.get(id)) throw errors.notFound('goal not found');
    sql.goalComplete.run(id);
    res.json(fullGoal(sql.goalGet.get(id)));
  } catch (e) { next(e); }
});

router.delete('/goals/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.goalDelete.run(id);
    if (info.changes === 0) throw errors.notFound('goal not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- obstacles ----------

router.post('/goals/:id/obstacles', (req, res, next) => {
  try {
    const goalId = intParam(req.params.id, 'id');
    if (!sql.goalGet.get(goalId)) throw errors.notFound('goal not found');
    rejectUnknownKeys(req.body, ['obstacle', 'if_then']);
    const obstacle = requireString(req.body, 'obstacle');
    const ifThen = requireString(req.body, 'if_then');
    const info = sql.obstacleInsert.run(goalId, obstacle, ifThen);
    res.status(201).json({ id: info.lastInsertRowid, goal_id: goalId, obstacle, if_then: ifThen });
  } catch (e) { next(e); }
});

router.delete('/obstacles/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.obstacleDelete.run(id);
    if (info.changes === 0) throw errors.notFound('obstacle not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- links ----------

router.post('/goals/:id/links', (req, res, next) => {
  try {
    const goalId = intParam(req.params.id, 'id');
    if (!sql.goalGet.get(goalId)) throw errors.notFound('goal not found');
    rejectUnknownKeys(req.body, ['kind', 'target_id', 'notes']);
    const kind = requireString(req.body, 'kind');
    if (!LINK_KINDS.has(kind)) throw errors.validation(`kind must be one of ${[...LINK_KINDS].join(', ')}`);
    const targetId = optionalInt(req.body, 'target_id');
    if (targetId == null) throw errors.validation('target_id required');
    const notes = optionalString(req.body, 'notes') ?? '';
    const info = sql.linkInsert.run(goalId, kind, targetId, notes);
    res.status(201).json({ id: info.lastInsertRowid, goal_id: goalId, kind, target_id: targetId, notes });
  } catch (e) { next(e); }
});

router.delete('/links/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.linkDelete.run(id);
    if (info.changes === 0) throw errors.notFound('link not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- check-ins ----------

router.get('/checkins', (req, res, next) => {
  try {
    const kind = req.query.kind ? String(req.query.kind) : null;
    if (kind && !CHECKIN_KINDS.has(kind)) throw errors.validation('bad kind');
    const from = String(req.query.from || '1900-01-01');
    const to   = String(req.query.to   || '9999-12-31');
    const rows = sql.checkinList.all(kind, kind, from, to).map(decodeCheck);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/checkins/today/:kind', (req, res, next) => {
  try {
    const kind = String(req.params.kind);
    if (!CHECKIN_KINDS.has(kind)) throw errors.validation('bad kind');
    res.json(decodeCheck(sql.checkinToday.get(kind, todayISO())) || null);
  } catch (e) { next(e); }
});

router.post('/checkins', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['kind', 'date', 'payload', 'coach_summary']);
    const kind = requireString(req.body, 'kind');
    if (!CHECKIN_KINDS.has(kind)) throw errors.validation('bad kind');
    const date = optionalString(req.body, 'date') ?? todayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('bad date');
    let payload = req.body?.payload ?? {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw errors.validation('payload must be an object');
    const summary = optionalString(req.body, 'coach_summary') ?? '';
    sql.checkinUpsert.run(kind, date, JSON.stringify(payload), summary);
    const row = sql.checkinToday.get(kind, date);
    res.status(201).json(decodeCheck(row));
  } catch (e) { next(e); }
});

router.patch('/checkins/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const existing = sql.checkinGet.get(id);
    if (!existing) throw errors.notFound('check-in not found');
    rejectUnknownKeys(req.body, ['payload', 'coach_summary']);
    let payload = parseJSON(existing.payload, {});
    if ('payload' in (req.body || {})) {
      const p = req.body.payload;
      if (typeof p !== 'object' || Array.isArray(p)) throw errors.validation('payload must be an object');
      payload = { ...payload, ...p };
    }
    const summary = optionalString(req.body, 'coach_summary');
    sql.checkinUpdate.run(JSON.stringify(payload), summary ?? existing.coach_summary, id);
    res.json(decodeCheck(sql.checkinGet.get(id)));
  } catch (e) { next(e); }
});

// ---------- settings ----------

router.get('/settings', (_req, res) => {
  res.json(sql.settingsGet.get());
});

router.patch('/settings', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, [
      'morning_enabled', 'morning_time', 'midday_enabled', 'midday_time',
      'evening_enabled', 'evening_time',
      'weekly_enabled', 'weekly_dow', 'vision_review_interval_days',
    ]);
    const updates = [];
    const vals = [];
    for (const k of ['morning_enabled', 'midday_enabled', 'evening_enabled', 'weekly_enabled']) {
      if (k in (req.body || {})) {
        updates.push(`${k} = ?`);
        vals.push(req.body[k] ? 1 : 0);
      }
    }
    for (const k of ['morning_time', 'midday_time', 'evening_time']) {
      const v = optionalString(req.body, k);
      if (v !== undefined) {
        // Range-checked, not just shaped: "99:99" matches \d{2}:\d{2} but is
        // not a time, and a cadence stored at 99:99 simply never comes due.
        if (!isValidHHMM(v)) throw errors.validation(`${k} must be a valid 24h HH:MM time`);
        updates.push(`${k} = ?`); vals.push(v);
      }
    }
    const dow = optionalInt(req.body, 'weekly_dow');
    if (dow !== undefined) {
      if (dow < 1 || dow > 7) throw errors.validation('weekly_dow must be 1..7 (ISO)');
      updates.push('weekly_dow = ?'); vals.push(dow);
    }
    const interval = optionalInt(req.body, 'vision_review_interval_days');
    if (interval !== undefined) {
      if (interval < 1) throw errors.validation('vision_review_interval_days must be >= 1');
      updates.push('vision_review_interval_days = ?'); vals.push(interval);
    }
    if (updates.length) {
      db.prepare(`UPDATE coach_settings SET ${updates.join(', ')} WHERE id = 1`).run(...vals);
    }
    res.json(sql.settingsGet.get());
  } catch (e) { next(e); }
});

// ---------- coaching profile ----------

router.patch('/coaching-profile', (req, res, next) => {
  try {
    const existing = JSON.parse(sql.getCoachingProfile.get()?.coaching_profile || '{}');
    const updates = req.body || {};
    const merged = mergeProfile(existing, updates);
    try { validateCoachingProfile(merged); } catch (e) { throw errors.validation(e.message); }
    sql.setCoachingProfile.run(JSON.stringify(merged));
    res.json(merged);
  } catch (e) { next(e); }
});

// ---------- briefing (the synthesis endpoint) ----------

function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400_000);
}

router.get('/briefing', (_req, res) => {
  const today = todayISO();
  const vision = shapeVision(sql.visionGet.get());
  const settings = sql.settingsGet.get();
  const morning = decodeCheck(sql.checkinToday.get('morning', today));
  const midday = decodeCheck(sql.checkinToday.get('midday', today));
  const evening = decodeCheck(sql.checkinToday.get('evening', today));
  const lastWeekly = decodeCheck(sql.lastCheckOfKind.get('weekly'));
  const lastVision = decodeCheck(sql.lastCheckOfKind.get('biweekly_vision'));

  const dow = isoDayOfWeek();
  const visionAge = daysSince(vision?.last_reviewed_at);
  const weeklyDue = settings.weekly_enabled && dow === settings.weekly_dow && !lastWeekly?.date?.startsWith(today.slice(0, 8));
  const visionDue = settings.vision_review_interval_days > 0 &&
    (visionAge == null || visionAge >= settings.vision_review_interval_days);

  // Active goals at the operational horizons, sorted compact.
  const activeGoals = sql.goalsByStatus.all('active');
  const focusGoals = activeGoals
    .filter((g) => ['week', 'month', 'quarter', 'year'].includes(g.horizon))
    .slice(0, 20)
    .map((g) => ({
      id: g.id, title: g.title, horizon: g.horizon,
      success_criteria: g.success_criteria, target_date: g.target_date,
    }));

  // Recent reflections (last 5 daily check-ins).
  const recentChecks = sql.recentChecks.all(5).map(decodeCheck);

  // Onboarding progress — drives the first-run setup card on Today.
  const counts = sql.counts.get() || {};
  const obVision = !!(((vision?.north_star) || '').trim() || ((vision?.identity_statement) || '').trim());
  const obGoals = (counts.goals || 0) > 0;
  const obSetup = (counts.habits || 0) > 0 || (counts.links || 0) > 0;
  const obRhythm = (counts.checkins || 0) > 0;
  let obNext = null;
  if (!obVision) obNext = 'vision';
  else if (!obGoals) obNext = 'goals';
  else if (!obSetup) obNext = 'setup';
  else if (!obRhythm) obNext = 'rhythm';
  const onboarding = {
    complete: obVision && obGoals && obSetup,
    next_step: obNext,
    steps: { vision: obVision, goals: obGoals, setup: obSetup, rhythm: obRhythm },
  };

  res.json({
    date: today,
    vision: {
      north_star: vision?.north_star || '',
      identity_statement: vision?.identity_statement || '',
      values: vision?.values || '',
      last_reviewed_at: vision?.last_reviewed_at,
      days_since_review: visionAge,
    },
    cadence_pending: {
      morning: !!settings.morning_enabled && !morning,
      // Time- and morning-gated server-side: every caller (API, MCP, Telegram)
      // must agree it isn't due yet, not just the Today view that hides it.
      midday: middayPending({ settings, middayCheckIn: midday, morningCheckIn: morning }),
      evening: !!settings.evening_enabled && !evening,
      weekly: weeklyDue,
      vision: visionDue,
    },
    today: {
      morning_check_in: morning,
      midday_check_in: midday,
      evening_check_in: evening,
    },
    active_goals: focusGoals,
    recent_check_ins: recentChecks,
    // Board reality. The Daily Command Meeting reconciles real tasks, so the
    // coach must see what's on the boards before it asks about priorities.
    task_snapshot: buildTaskSnapshot({ db, today }),
    coach_settings: settings,
    onboarding,
  });
});

export default router;
