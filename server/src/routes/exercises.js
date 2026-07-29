import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import {
  intParam, requireString, optionalString, rejectUnknownKeys,
} from '../lib/validate.js';
import { epley, sessionSummary, cardioSessionSummary, liftingSuggestion } from '../lib/workouts-math.js';

const router = Router();

const sql = {
  listActive: db.prepare(`
    SELECT id, name, kind, muscle_group, notes, archived_at, created_at, updated_at
    FROM exercises WHERE archived_at IS NULL
    ORDER BY LOWER(name)
  `),
  listAll: db.prepare(`
    SELECT id, name, kind, muscle_group, notes, archived_at, created_at, updated_at
    FROM exercises
    ORDER BY archived_at IS NOT NULL, LOWER(name)
  `),
  get: db.prepare(`
    SELECT id, name, kind, muscle_group, notes, archived_at, created_at, updated_at
    FROM exercises WHERE id = ?
  `),
  byNameActive: db.prepare(`
    SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) AND archived_at IS NULL
  `),
  insert: db.prepare(`
    INSERT INTO exercises (name, kind, muscle_group, notes)
    VALUES (?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM exercises WHERE id = ?'),
  archive: db.prepare("UPDATE exercises SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND archived_at IS NULL"),
  unarchive: db.prepare('UPDATE exercises SET archived_at = NULL WHERE id = ?'),

  // Sessions = workouts that included this exercise, with the sets for that exercise.
  sessionsForExercise: db.prepare(`
    SELECT w.id AS workout_id, w.started_at, w.ended_at, w.name AS workout_name,
           we.id AS workout_exercise_id, we.notes AS we_notes
    FROM workouts w
    JOIN workout_exercises we ON we.workout_id = w.id
    WHERE we.exercise_id = ?
      AND w.started_at >= ?
      AND w.started_at <= ?
    ORDER BY w.started_at DESC
    LIMIT ?
  `),
  setsForWorkoutExercise: db.prepare(`
    SELECT id, workout_exercise_id, position, weight_kg, reps,
           time_seconds, distance_m, rpe, completed, is_warmup, note, completed_at, created_at
    FROM sets WHERE workout_exercise_id = ?
    ORDER BY position, id
  `),
};

function searchLike(q) {
  // Case-insensitive LIKE; escape % and _ in the query string.
  const pat = `%${String(q).replace(/[%_]/g, '\\$&')}%`;
  return pat;
}

router.get('/', (req, res, next) => {
  try {
    const includeArchived = String(req.query.include || '') === 'archived';
    const q = req.query.q ? String(req.query.q).trim() : null;
    const kind = req.query.kind ? String(req.query.kind) : null;
    if (kind && !['lifting', 'cardio'].includes(kind)) {
      throw errors.validation("kind must be 'lifting' or 'cardio'");
    }

    let rows = (includeArchived ? sql.listAll : sql.listActive).all();
    if (kind) rows = rows.filter((r) => r.kind === kind);
    if (q) {
      const lower = q.toLowerCase();
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(lower) ||
        r.muscle_group.toLowerCase().includes(lower),
      );
    }
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'kind', 'muscle_group', 'notes']);
    const name = requireString(req.body, 'name');
    if (sql.byNameActive.get(name)) throw errors.conflict(`exercise "${name}" already exists`);
    const kind = optionalString(req.body, 'kind') ?? 'lifting';
    if (!['lifting', 'cardio'].includes(kind)) {
      throw errors.validation("kind must be 'lifting' or 'cardio'");
    }
    const muscle = optionalString(req.body, 'muscle_group') ?? '';
    const notes = optionalString(req.body, 'notes') ?? '';
    try {
      const info = sql.insert.run(name, kind, muscle, notes);
      res.status(201).json(sql.get.get(info.lastInsertRowid));
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw errors.conflict('exercise name already exists');
      throw err;
    }
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.get.get(id);
    if (!row) throw errors.notFound('exercise not found');
    res.json(row);
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['name', 'kind', 'muscle_group', 'notes', 'archived']);
    const updates = [];
    const vals = [];

    const nameRaw = optionalString(req.body, 'name');
    if (nameRaw !== undefined) {
      if (!nameRaw || !nameRaw.trim()) throw errors.validation('name must be non-empty');
      const dup = sql.byNameActive.get(nameRaw.trim());
      if (dup && dup.id !== id) throw errors.conflict(`exercise "${nameRaw.trim()}" already exists`);
      updates.push('name = ?'); vals.push(nameRaw.trim());
    }
    const kindRaw = optionalString(req.body, 'kind');
    if (kindRaw !== undefined) {
      if (!['lifting', 'cardio'].includes(kindRaw)) {
        throw errors.validation("kind must be 'lifting' or 'cardio'");
      }
      updates.push('kind = ?'); vals.push(kindRaw);
    }
    const muscleRaw = optionalString(req.body, 'muscle_group');
    if (muscleRaw !== undefined) { updates.push('muscle_group = ?'); vals.push(muscleRaw ?? ''); }
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) { updates.push('notes = ?'); vals.push(notesRaw ?? ''); }

    if ('archived' in (req.body || {})) {
      const archived = req.body.archived;
      if (typeof archived !== 'boolean') throw errors.validation('archived must be boolean');
      (archived ? sql.archive : sql.unarchive).run(id);
    }

    if (updates.length) {
      vals.push(id);
      try {
        const info = db.prepare(`UPDATE exercises SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
        if (info.changes === 0) throw errors.notFound('exercise not found');
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw errors.conflict('exercise name already exists');
        throw err;
      }
    } else {
      if (!sql.get.get(id)) throw errors.notFound('exercise not found');
    }
    res.json(sql.get.get(id));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    try {
      const info = sql.delete.run(id);
      if (info.changes === 0) throw errors.notFound('exercise not found');
      res.status(204).end();
    } catch (err) {
      // better-sqlite3 surfaces FK violations as SQLITE_CONSTRAINT_TRIGGER
      // (SQLite implements FK enforcement via internal triggers) with the
      // message containing "FOREIGN KEY".
      if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
          (err.code?.startsWith?.('SQLITE_CONSTRAINT') && /foreign key/i.test(err.message))) {
        throw errors.conflict('exercise is referenced by past workouts or routines — PATCH { archived: true } to archive instead');
      }
      throw err;
    }
  } catch (e) { next(e); }
});

// GET /api/exercises/:id/history?from=&to=&limit=
router.get('/:id/history', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const ex = sql.get.get(id);
    if (!ex) throw errors.notFound('exercise not found');

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const from = String(req.query.from || '1900-01-01');
    const to = String(req.query.to || '9999-12-31');
    if (!/^\d{4}-\d{2}-\d{2}/.test(from) || !/^\d{4}-\d{2}-\d{2}/.test(to)) {
      throw errors.validation('from/to must be ISO 8601');
    }

    const sessions = sql.sessionsForExercise.all(id, from, to + 'T23:59:59.999Z', limit);
    const out = sessions.map((s) => ({
      workout_id: s.workout_id,
      workout_name: s.workout_name,
      started_at: s.started_at,
      ended_at: s.ended_at,
      notes: s.we_notes,
      sets: sql.setsForWorkoutExercise.all(s.workout_exercise_id),
    }));

    res.json({ exercise: ex, sessions: out });
  } catch (e) { next(e); }
});

// GET /api/exercises/:id/stats?days=180
router.get('/:id/stats', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const ex = sql.get.get(id);
    if (!ex) throw errors.notFound('exercise not found');

    const days = Math.min(Math.max(Number(req.query.days) || 180, 7), 730);
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const sessions = sql.sessionsForExercise.all(id, fromIso, toIso, 500);
    const fullSessions = sessions.map((s) => ({
      ...s,
      sets: sql.setsForWorkoutExercise.all(s.workout_exercise_id),
    }));

    if (ex.kind === 'cardio') {
      const summaries = fullSessions.map((s) => ({
        date: s.started_at.slice(0, 10),
        ...cardioSessionSummary(s.sets),
      }));
      const longestTime = summaries.reduce((m, x) => Math.max(m, x.total_time_s), 0);
      const farthest = summaries.reduce((m, x) => Math.max(m, x.total_distance_m), 0);
      const paces = summaries.map((x) => x.avg_pace_s_per_km).filter((x) => x != null);
      const bestPace = paces.length ? Math.min(...paces) : null;
      res.json({
        exercise: ex,
        from: from.toISOString(),
        to: to.toISOString(),
        pr: {
          longest_time_s: longestTime,
          farthest_distance_m: farthest,
          best_pace_s_per_km: bestPace,
        },
        sessions: summaries,
        last_session: fullSessions[0] || null,
        suggestion: null,
      });
      return;
    }

    // Lifting
    let bestE1rmRow = null;
    let heaviestRow = null;
    let bestVolumeRow = null;
    const sessionSummaries = [];

    for (const s of fullSessions) {
      const summary = sessionSummary(s.sets);
      sessionSummaries.push({
        date: s.started_at.slice(0, 10),
        workout_id: s.workout_id,
        ...summary,
      });
      // PR scanning
      for (const set of s.sets) {
        if (!set.completed || set.is_warmup) continue;
        if (set.weight_kg == null || set.reps == null) continue;
        const e = epley(set.weight_kg, set.reps);
        if (!bestE1rmRow || e > bestE1rmRow.e1rm) {
          bestE1rmRow = { e1rm: e, weight: set.weight_kg, reps: set.reps, at: set.completed_at || s.started_at };
        }
        if (!heaviestRow || set.weight_kg > heaviestRow.weight) {
          heaviestRow = { weight: set.weight_kg, reps: set.reps, at: set.completed_at || s.started_at };
        }
      }
      if (summary.total_volume > 0) {
        if (!bestVolumeRow || summary.total_volume > bestVolumeRow.volume) {
          bestVolumeRow = { volume: summary.total_volume, at: s.started_at };
        }
      }
    }

    const suggestion = liftingSuggestion(fullSessions[0] || null);

    res.json({
      exercise: ex,
      from: from.toISOString(),
      to: to.toISOString(),
      pr: {
        best_e1rm_kg: bestE1rmRow ? round2(bestE1rmRow.e1rm) : 0,
        best_e1rm_at: bestE1rmRow?.at ?? null,
        best_e1rm_weight: bestE1rmRow?.weight ?? null,
        best_e1rm_reps: bestE1rmRow?.reps ?? null,
        heaviest_weight_kg: heaviestRow?.weight ?? 0,
        heaviest_at: heaviestRow?.at ?? null,
        heaviest_reps: heaviestRow?.reps ?? null,
        best_volume_kg: bestVolumeRow?.volume ?? 0,
        best_volume_at: bestVolumeRow?.at ?? null,
      },
      sessions: sessionSummaries,
      last_session: fullSessions[0] || null,
      suggestion,
    });
  } catch (e) { next(e); }
});

function round2(n) { return Math.round(n * 100) / 100; }

export default router;
