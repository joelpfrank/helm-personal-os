import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, optionalString, optionalNumber, optionalInt, rejectUnknownKeys,
} from '../lib/validate.js';

const router = Router();

const sql = {
  listWorkouts: db.prepare(`
    SELECT id, name, routine_id, started_at, ended_at, notes, created_at, updated_at
    FROM workouts
    WHERE started_at BETWEEN ? AND ?
    ORDER BY started_at DESC
    LIMIT ?
  `),
  getWorkout: db.prepare(`
    SELECT id, name, routine_id, started_at, ended_at, notes, created_at, updated_at
    FROM workouts WHERE id = ?
  `),
  active: db.prepare(`
    SELECT id, name, routine_id, started_at, ended_at, notes, created_at, updated_at
    FROM workouts WHERE ended_at IS NULL LIMIT 1
  `),
  insertWorkout: db.prepare(`
    INSERT INTO workouts (name, routine_id) VALUES (?, ?)
  `),
  endWorkout: db.prepare("UPDATE workouts SET ended_at = ? WHERE id = ?"),
  deleteWorkout: db.prepare('DELETE FROM workouts WHERE id = ?'),

  weList: db.prepare(`
    SELECT id, workout_id, exercise_id, position, superset_group, notes
    FROM workout_exercises WHERE workout_id = ?
    ORDER BY position, id
  `),
  weGet: db.prepare(`
    SELECT id, workout_id, exercise_id, position, superset_group, notes
    FROM workout_exercises WHERE id = ?
  `),
  weInsert: db.prepare(`
    INSERT INTO workout_exercises (workout_id, exercise_id, position, superset_group, notes)
    VALUES (?, ?, ?, ?, ?)
  `),
  weDelete: db.prepare('DELETE FROM workout_exercises WHERE id = ?'),

  exerciseGet: db.prepare('SELECT id, name, kind FROM exercises WHERE id = ?'),
  exerciseExists: db.prepare('SELECT 1 AS x FROM exercises WHERE id = ? AND archived_at IS NULL'),

  setsForWe: db.prepare(`
    SELECT id, workout_exercise_id, position, weight_kg, reps,
           time_seconds, distance_m, rpe, completed, is_warmup, note, completed_at, created_at
    FROM sets WHERE workout_exercise_id = ?
    ORDER BY position, id
  `),
  setGet: db.prepare(`
    SELECT id, workout_exercise_id, position, weight_kg, reps,
           time_seconds, distance_m, rpe, completed, is_warmup, note, completed_at, created_at
    FROM sets WHERE id = ?
  `),
  setInsert: db.prepare(`
    INSERT INTO sets (
      workout_exercise_id, position, weight_kg, reps,
      time_seconds, distance_m, rpe, completed, is_warmup, note, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  setDelete: db.prepare('DELETE FROM sets WHERE id = ?'),
  setComplete: db.prepare("UPDATE sets SET completed = 1, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"),

  // For routine→workout copy at start time.
  routineGet: db.prepare(`
    SELECT id, name, notes FROM routines WHERE id = ?
  `),
  reForRoutine: db.prepare(`
    SELECT id, routine_id, exercise_id, position, target_sets, target_reps,
           target_weight, target_time_seconds, target_distance_m, superset_group, notes
    FROM routine_exercises WHERE routine_id = ?
    ORDER BY position, id
  `),

  // Find the workout_exercise that this set belongs to → its workout_id.
  setLineage: db.prepare(`
    SELECT s.id AS set_id, we.id AS we_id, we.workout_id, w.ended_at, e.kind
    FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id
    JOIN exercises e ON e.id = we.exercise_id
    WHERE s.id = ?
  `),
  weLineage: db.prepare(`
    SELECT we.id AS we_id, we.workout_id, w.ended_at, e.kind
    FROM workout_exercises we
    JOIN workouts w ON w.id = we.workout_id
    JOIN exercises e ON e.id = we.exercise_id
    WHERE we.id = ?
  `),
};

function fullWorkout(row) {
  const exercises = sql.weList.all(row.id).map((we) => ({
    ...we,
    exercise: sql.exerciseGet.get(we.exercise_id),
    sets: sql.setsForWe.all(we.id),
  }));
  return { ...row, exercises };
}

function nowIso() {
  return new Date().toISOString().replace(/(\.\d{3})Z$/, (_m, ms) => ms + 'Z');
}

router.get('/', (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const from = String(req.query.from || '1900-01-01');
    const to = String(req.query.to || '9999-12-31');
    res.json(sql.listWorkouts.all(from, to + 'T23:59:59.999Z', limit));
  } catch (e) { next(e); }
});

router.get('/active', (_req, res, next) => {
  try {
    const w = sql.active.get();
    if (!w) throw errors.notFound('no active workout');
    res.json(fullWorkout(w));
  } catch (e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'routine_id']);
    const name = optionalString(req.body, 'name') ?? '';
    const routineId = optionalInt(req.body, 'routine_id');

    let resolvedName = name;
    if (routineId != null) {
      const r = sql.routineGet.get(routineId);
      if (!r) throw errors.notFound(`routine ${routineId} not found`);
      if (!resolvedName) resolvedName = r.name;
    }

    const tx = db.transaction(() => {
      let info;
      try {
        info = sql.insertWorkout.run(resolvedName, routineId ?? null);
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          const existing = sql.active.get();
          throw errors.conflict(`active workout already exists (id ${existing.id}, started ${existing.started_at}). End it or DELETE first.`);
        }
        throw err;
      }
      const workoutId = info.lastInsertRowid;
      if (routineId != null) {
        const seeds = sql.reForRoutine.all(routineId);
        let wePos = 1000;
        for (const re of seeds) {
          const ex = sql.exerciseGet.get(re.exercise_id);
          if (!ex) continue;
          const weInfo = sql.weInsert.run(
            workoutId, re.exercise_id, wePos, re.superset_group ?? null, re.notes ?? '',
          );
          wePos += 1000;
          // Seed empty sets per target_sets (uncompleted, not warmups).
          let setPos = 1000;
          for (let i = 0; i < (re.target_sets || 0); i++) {
            sql.setInsert.run(
              weInfo.lastInsertRowid,
              setPos,
              ex.kind === 'lifting' ? (re.target_weight ?? null) : null,
              ex.kind === 'lifting' ? (re.target_reps ?? null) : null,
              ex.kind === 'cardio' ? (re.target_time_seconds ?? null) : null,
              ex.kind === 'cardio' ? (re.target_distance_m ?? null) : null,
              null, 0, 0, '', null,
            );
            setPos += 1000;
          }
        }
      }
      return workoutId;
    });
    const id = tx();
    res.status(201).json(fullWorkout(sql.getWorkout.get(id)));
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.getWorkout.get(id);
    if (!row) throw errors.notFound('workout not found');
    res.json(fullWorkout(row));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['name', 'notes', 'started_at', 'ended_at']);
    const updates = [];
    const vals = [];
    const nameRaw = optionalString(req.body, 'name');
    if (nameRaw !== undefined) { updates.push('name = ?'); vals.push(nameRaw ?? ''); }
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) { updates.push('notes = ?'); vals.push(notesRaw ?? ''); }
    const startedRaw = optionalString(req.body, 'started_at');
    if (startedRaw !== undefined) {
      if (!startedRaw) throw errors.validation('started_at cannot be empty');
      updates.push('started_at = ?'); vals.push(startedRaw);
    }
    if ('ended_at' in (req.body || {})) {
      const e = req.body.ended_at;
      if (e === null) { updates.push('ended_at = NULL'); }
      else if (typeof e !== 'string') throw errors.validation('ended_at must be string or null');
      else if (e === 'now') { updates.push('ended_at = ?'); vals.push(nowIso()); }
      else { updates.push('ended_at = ?'); vals.push(e); }
    }
    if (!updates.length) {
      const row = sql.getWorkout.get(id);
      if (!row) throw errors.notFound('workout not found');
      return res.json(fullWorkout(row));
    }
    vals.push(id);
    try {
      const info = db.prepare(`UPDATE workouts SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      if (info.changes === 0) throw errors.notFound('workout not found');
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw errors.conflict('cannot un-end this workout while another is active');
      }
      throw err;
    }
    res.json(fullWorkout(sql.getWorkout.get(id)));
  } catch (e) { next(e); }
});

router.post('/:id/end', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (!sql.getWorkout.get(id)) throw errors.notFound('workout not found');
    rejectUnknownKeys(req.body, ['ended_at', 'notes']);
    const endedAt = optionalString(req.body, 'ended_at') || nowIso();
    sql.endWorkout.run(endedAt, id);
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) {
      db.prepare('UPDATE workouts SET notes = ? WHERE id = ?').run(notesRaw ?? '', id);
    }
    res.json(fullWorkout(sql.getWorkout.get(id)));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.deleteWorkout.run(id);
    if (info.changes === 0) throw errors.notFound('workout not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// Nested workout_exercises.

router.post('/:id/exercises', (req, res, next) => {
  try {
    const workoutId = intParam(req.params.id, 'id');
    if (!sql.getWorkout.get(workoutId)) throw errors.notFound('workout not found');
    rejectUnknownKeys(req.body, ['exercise_id', 'position', 'superset_group', 'notes']);
    const exId = req.body.exercise_id;
    if (!Number.isInteger(exId)) throw errors.validation('exercise_id required');
    if (!sql.exerciseExists.get(exId)) throw errors.notFound(`exercise ${exId} not found or archived`);
    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.weList.all(workoutId)) : positionRaw;
    const supersetGroup = optionalInt(req.body, 'superset_group');
    const notes = optionalString(req.body, 'notes') ?? '';
    const info = sql.weInsert.run(workoutId, exId, position, supersetGroup ?? null, notes);
    const we = sql.weGet.get(info.lastInsertRowid);
    res.status(201).json({ ...we, exercise: sql.exerciseGet.get(exId), sets: [] });
  } catch (e) { next(e); }
});

router.patch('/exercise/:weId', (req, res, next) => {
  try {
    const weId = intParam(req.params.weId, 'weId');
    rejectUnknownKeys(req.body, ['position', 'superset_group', 'notes']);
    const updates = [];
    const vals = [];
    const positionRaw = optionalNumber(req.body, 'position');
    if (positionRaw !== undefined) { updates.push('position = ?'); vals.push(positionRaw); }
    const supersetGroup = optionalInt(req.body, 'superset_group');
    if (supersetGroup !== undefined) { updates.push('superset_group = ?'); vals.push(supersetGroup); }
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) { updates.push('notes = ?'); vals.push(notesRaw ?? ''); }
    if (!updates.length) {
      const we = sql.weGet.get(weId);
      if (!we) throw errors.notFound('workout_exercise not found');
      return res.json({ ...we, exercise: sql.exerciseGet.get(we.exercise_id), sets: sql.setsForWe.all(we.id) });
    }
    vals.push(weId);
    const info = db.prepare(`UPDATE workout_exercises SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) throw errors.notFound('workout_exercise not found');
    const we = sql.weGet.get(weId);
    res.json({ ...we, exercise: sql.exerciseGet.get(we.exercise_id), sets: sql.setsForWe.all(we.id) });
  } catch (e) { next(e); }
});

router.delete('/exercise/:weId', (req, res, next) => {
  try {
    const weId = intParam(req.params.weId, 'weId');
    const info = sql.weDelete.run(weId);
    if (info.changes === 0) throw errors.notFound('workout_exercise not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// Sets.

function validateSetBody(body, kind) {
  rejectUnknownKeys(body, [
    'position', 'weight_kg', 'reps',
    'time_seconds', 'distance_m', 'rpe',
    'completed', 'is_warmup', 'note',
  ]);
  const out = {};
  out.position = optionalNumber(body, 'position');
  if (kind === 'lifting') {
    if ('time_seconds' in (body || {}) || 'distance_m' in (body || {})) {
      throw errors.validation('time_seconds/distance_m not allowed on lifting sets');
    }
    out.weight_kg = optionalNumber(body, 'weight_kg');
    out.reps = optionalInt(body, 'reps');
    if (out.weight_kg != null && out.weight_kg < 0) throw errors.validation('weight_kg must be ≥ 0');
    if (out.reps != null && out.reps < 0) throw errors.validation('reps must be ≥ 0');
    out.time_seconds = null;
    out.distance_m = null;
  } else {
    if ('weight_kg' in (body || {}) || 'reps' in (body || {})) {
      throw errors.validation('weight_kg/reps not allowed on cardio sets');
    }
    out.time_seconds = optionalInt(body, 'time_seconds');
    out.distance_m = optionalNumber(body, 'distance_m');
    if (out.time_seconds != null && out.time_seconds < 0) throw errors.validation('time_seconds must be ≥ 0');
    if (out.distance_m != null && out.distance_m < 0) throw errors.validation('distance_m must be ≥ 0');
    out.weight_kg = null;
    out.reps = null;
  }
  out.rpe = optionalNumber(body, 'rpe');
  if (out.rpe != null && (out.rpe < 1 || out.rpe > 10)) throw errors.validation('rpe must be in [1,10]');
  const completed = body?.completed;
  if (completed !== undefined && typeof completed !== 'boolean') {
    throw errors.validation('completed must be boolean');
  }
  out.completed = completed === true ? 1 : 0;
  const warmup = body?.is_warmup;
  if (warmup !== undefined && typeof warmup !== 'boolean') {
    throw errors.validation('is_warmup must be boolean');
  }
  out.is_warmup = warmup === true ? 1 : 0;
  out.note = optionalString(body, 'note') ?? '';
  return out;
}

router.post('/exercise/:weId/sets', (req, res, next) => {
  try {
    const weId = intParam(req.params.weId, 'weId');
    const lineage = sql.weLineage.get(weId);
    if (!lineage) throw errors.notFound('workout_exercise not found');
    const fields = validateSetBody(req.body || {}, lineage.kind);
    const position = fields.position == null ? appendPosition(sql.setsForWe.all(weId)) : fields.position;
    const completedAt = fields.completed ? nowIso() : null;
    const info = sql.setInsert.run(
      weId, position,
      fields.weight_kg, fields.reps,
      fields.time_seconds, fields.distance_m,
      fields.rpe, fields.completed, fields.is_warmup, fields.note, completedAt,
    );
    res.status(201).json(sql.setGet.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.patch('/sets/:setId', (req, res, next) => {
  try {
    const setId = intParam(req.params.setId, 'setId');
    const lineage = sql.setLineage.get(setId);
    if (!lineage) throw errors.notFound('set not found');
    const fields = validateSetBody(req.body || {}, lineage.kind);

    const updates = [];
    const vals = [];
    const bodyKeys = Object.keys(req.body || {});
    if (bodyKeys.includes('position') && fields.position != null) { updates.push('position = ?'); vals.push(fields.position); }
    if (bodyKeys.includes('weight_kg')) { updates.push('weight_kg = ?'); vals.push(fields.weight_kg); }
    if (bodyKeys.includes('reps')) { updates.push('reps = ?'); vals.push(fields.reps); }
    if (bodyKeys.includes('time_seconds')) { updates.push('time_seconds = ?'); vals.push(fields.time_seconds); }
    if (bodyKeys.includes('distance_m')) { updates.push('distance_m = ?'); vals.push(fields.distance_m); }
    if (bodyKeys.includes('rpe')) { updates.push('rpe = ?'); vals.push(fields.rpe); }
    if (bodyKeys.includes('completed')) {
      updates.push('completed = ?'); vals.push(fields.completed);
      if (fields.completed) { updates.push('completed_at = ?'); vals.push(nowIso()); }
      else { updates.push('completed_at = NULL'); }
    }
    if (bodyKeys.includes('is_warmup')) { updates.push('is_warmup = ?'); vals.push(fields.is_warmup); }
    if (bodyKeys.includes('note')) { updates.push('note = ?'); vals.push(fields.note); }

    if (!updates.length) return res.json(sql.setGet.get(setId));
    vals.push(setId);
    db.prepare(`UPDATE sets SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    res.json(sql.setGet.get(setId));
  } catch (e) { next(e); }
});

router.post('/sets/:setId/complete', (req, res, next) => {
  try {
    const setId = intParam(req.params.setId, 'setId');
    const info = sql.setComplete.run(setId);
    if (info.changes === 0) throw errors.notFound('set not found');
    res.json(sql.setGet.get(setId));
  } catch (e) { next(e); }
});

router.delete('/sets/:setId', (req, res, next) => {
  try {
    const setId = intParam(req.params.setId, 'setId');
    const info = sql.setDelete.run(setId);
    if (info.changes === 0) throw errors.notFound('set not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
