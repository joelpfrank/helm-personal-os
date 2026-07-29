import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, requireString, optionalString, optionalNumber, optionalInt, rejectUnknownKeys,
} from '../lib/validate.js';

const router = Router();

const sql = {
  listActive: db.prepare(`
    SELECT id, name, notes, position, archived_at, created_at, updated_at
    FROM routines WHERE archived_at IS NULL
    ORDER BY position, id
  `),
  listAll: db.prepare(`
    SELECT id, name, notes, position, archived_at, created_at, updated_at
    FROM routines
    ORDER BY archived_at IS NOT NULL, position, id
  `),
  get: db.prepare(`
    SELECT id, name, notes, position, archived_at, created_at, updated_at
    FROM routines WHERE id = ?
  `),
  insert: db.prepare(`
    INSERT INTO routines (name, notes, position)
    VALUES (?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM routines WHERE id = ?'),
  archive: db.prepare("UPDATE routines SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND archived_at IS NULL"),
  unarchive: db.prepare('UPDATE routines SET archived_at = NULL WHERE id = ?'),

  reList: db.prepare(`
    SELECT id, routine_id, exercise_id, position, target_sets, target_reps,
           target_weight, target_time_seconds, target_distance_m, superset_group, notes
    FROM routine_exercises WHERE routine_id = ?
    ORDER BY position, id
  `),
  reInsert: db.prepare(`
    INSERT INTO routine_exercises (
      routine_id, exercise_id, position, target_sets, target_reps,
      target_weight, target_time_seconds, target_distance_m, superset_group, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  reGet: db.prepare(`
    SELECT id, routine_id, exercise_id, position, target_sets, target_reps,
           target_weight, target_time_seconds, target_distance_m, superset_group, notes
    FROM routine_exercises WHERE id = ?
  `),
  reDelete: db.prepare('DELETE FROM routine_exercises WHERE id = ?'),

  exerciseExists: db.prepare('SELECT 1 AS x FROM exercises WHERE id = ? AND archived_at IS NULL'),
};

function fullRoutine(row) {
  return { ...row, exercises: sql.reList.all(row.id) };
}

router.get('/', (req, res) => {
  const include = String(req.query.include || '');
  const rows = include === 'archived' ? sql.listAll.all() : sql.listActive.all();
  res.json(rows.map(fullRoutine));
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'notes', 'position', 'exercises']);
    const name = requireString(req.body, 'name');
    const notes = optionalString(req.body, 'notes') ?? '';
    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.listActive.all()) : positionRaw;

    const seedExercises = Array.isArray(req.body.exercises) ? req.body.exercises : [];
    for (const e of seedExercises) {
      if (!e || typeof e !== 'object') throw errors.validation('exercises[] entries must be objects');
      if (!Number.isInteger(e.exercise_id)) throw errors.validation('each seed exercise needs exercise_id');
      if (!sql.exerciseExists.get(e.exercise_id)) throw errors.notFound(`exercise ${e.exercise_id} not found`);
    }

    const tx = db.transaction(() => {
      const info = sql.insert.run(name, notes, position);
      const routineId = info.lastInsertRowid;
      let pos = 1000;
      for (const e of seedExercises) {
        sql.reInsert.run(
          routineId,
          e.exercise_id,
          e.position ?? pos,
          Number.isInteger(e.target_sets) ? e.target_sets : 3,
          Number.isInteger(e.target_reps) ? e.target_reps : null,
          Number.isFinite(e.target_weight) ? e.target_weight : null,
          Number.isInteger(e.target_time_seconds) ? e.target_time_seconds : null,
          Number.isFinite(e.target_distance_m) ? e.target_distance_m : null,
          Number.isInteger(e.superset_group) ? e.superset_group : null,
          typeof e.notes === 'string' ? e.notes : '',
        );
        pos += 1000;
      }
      return routineId;
    });
    const id = tx();
    res.status(201).json(fullRoutine(sql.get.get(id)));
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.get.get(id);
    if (!row) throw errors.notFound('routine not found');
    res.json(fullRoutine(row));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['name', 'notes', 'position', 'archived']);
    const updates = [];
    const vals = [];

    const nameRaw = optionalString(req.body, 'name');
    if (nameRaw !== undefined) {
      if (!nameRaw || !nameRaw.trim()) throw errors.validation('name must be non-empty');
      updates.push('name = ?'); vals.push(nameRaw.trim());
    }
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) { updates.push('notes = ?'); vals.push(notesRaw ?? ''); }
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
      const info = db.prepare(`UPDATE routines SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      if (info.changes === 0) throw errors.notFound('routine not found');
    } else {
      if (!sql.get.get(id)) throw errors.notFound('routine not found');
    }
    res.json(fullRoutine(sql.get.get(id)));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('routine not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// Nested routine_exercises CRUD.

router.post('/:id/exercises', (req, res, next) => {
  try {
    const routineId = intParam(req.params.id, 'id');
    if (!sql.get.get(routineId)) throw errors.notFound('routine not found');
    rejectUnknownKeys(req.body, [
      'exercise_id', 'position', 'target_sets', 'target_reps',
      'target_weight', 'target_time_seconds', 'target_distance_m',
      'superset_group', 'notes',
    ]);
    const exId = req.body.exercise_id;
    if (!Number.isInteger(exId)) throw errors.validation('exercise_id is required');
    if (!sql.exerciseExists.get(exId)) throw errors.notFound(`exercise ${exId} not found`);

    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.reList.all(routineId)) : positionRaw;
    const targetSets = optionalInt(req.body, 'target_sets') ?? 3;
    const targetReps = optionalInt(req.body, 'target_reps');
    const targetWeight = optionalNumber(req.body, 'target_weight');
    const targetTime = optionalInt(req.body, 'target_time_seconds');
    const targetDist = optionalNumber(req.body, 'target_distance_m');
    const supersetGroup = optionalInt(req.body, 'superset_group');
    const notes = optionalString(req.body, 'notes') ?? '';

    const info = sql.reInsert.run(
      routineId, exId, position, targetSets,
      targetReps ?? null, targetWeight ?? null,
      targetTime ?? null, targetDist ?? null,
      supersetGroup ?? null, notes,
    );
    res.status(201).json(sql.reGet.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.patch('/exercise/:reId', (req, res, next) => {
  try {
    const reId = intParam(req.params.reId, 'reId');
    rejectUnknownKeys(req.body, [
      'position', 'target_sets', 'target_reps',
      'target_weight', 'target_time_seconds', 'target_distance_m',
      'superset_group', 'notes',
    ]);
    const updates = [];
    const vals = [];
    const positionRaw = optionalNumber(req.body, 'position');
    if (positionRaw !== undefined) { updates.push('position = ?'); vals.push(positionRaw); }
    const targetSets = optionalInt(req.body, 'target_sets');
    if (targetSets !== undefined) { updates.push('target_sets = ?'); vals.push(targetSets ?? 3); }
    const targetReps = optionalInt(req.body, 'target_reps');
    if (targetReps !== undefined) { updates.push('target_reps = ?'); vals.push(targetReps); }
    const targetWeight = optionalNumber(req.body, 'target_weight');
    if (targetWeight !== undefined) { updates.push('target_weight = ?'); vals.push(targetWeight); }
    const targetTime = optionalInt(req.body, 'target_time_seconds');
    if (targetTime !== undefined) { updates.push('target_time_seconds = ?'); vals.push(targetTime); }
    const targetDist = optionalNumber(req.body, 'target_distance_m');
    if (targetDist !== undefined) { updates.push('target_distance_m = ?'); vals.push(targetDist); }
    // superset_group: explicit null clears the link; absent key leaves it.
    const supersetGroup = optionalInt(req.body, 'superset_group');
    if (supersetGroup !== undefined) { updates.push('superset_group = ?'); vals.push(supersetGroup); }
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) { updates.push('notes = ?'); vals.push(notesRaw ?? ''); }

    if (!updates.length) {
      const row = sql.reGet.get(reId);
      if (!row) throw errors.notFound('routine_exercise not found');
      return res.json(row);
    }
    vals.push(reId);
    const info = db.prepare(`UPDATE routine_exercises SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) throw errors.notFound('routine_exercise not found');
    res.json(sql.reGet.get(reId));
  } catch (e) { next(e); }
});

router.delete('/exercise/:reId', (req, res, next) => {
  try {
    const reId = intParam(req.params.reId, 'reId');
    const info = sql.reDelete.run(reId);
    if (info.changes === 0) throw errors.notFound('routine_exercise not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
