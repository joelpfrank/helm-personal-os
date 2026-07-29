import { apiGet, apiPost } from './api.js';

function notFound(msg) {
  const e = new Error(msg);
  e.code = 'not_found';
  return e;
}

function ambiguous(candidates) {
  const e = new Error(`ambiguous_name: matched ${candidates.length} items: ${candidates.map((c) => `id=${c.id} name="${c.name}"`).join(', ')}`);
  e.code = 'ambiguous_name';
  return e;
}

function lowerEq(a, b) { return a.toLowerCase() === b.toLowerCase(); }

export async function resolveBoard({ board_id, name }) {
  if (board_id != null) {
    const board = await apiGet(`/boards/${board_id}`);
    return board;
  }
  if (!name) throw new Error('either board_id or name required');
  const boards = await apiGet('/boards');
  const matches = boards.filter((b) => lowerEq(b.name, name));
  if (matches.length === 0) throw notFound(`board "${name}" not found`);
  if (matches.length > 1) throw ambiguous(matches);
  return apiGet(`/boards/${matches[0].id}`);
}

export async function resolveColumn(board, { column_id, column_name }) {
  if (column_id != null) {
    const col = board.columns.find((c) => c.id === column_id);
    if (!col) throw notFound(`column id ${column_id} not in board ${board.id}`);
    return col;
  }
  if (!column_name) throw new Error('either column_id or column_name required');
  const matches = board.columns.filter((c) => lowerEq(c.name, column_name));
  if (matches.length === 0) throw notFound(`column "${column_name}" not found in board "${board.name}"`);
  if (matches.length > 1) throw ambiguous(matches);
  return matches[0];
}

export async function resolveOrCreateTags(names) {
  if (!names?.length) return [];
  const existing = await apiGet('/tags');
  const result = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    let tag = existing.find((t) => lowerEq(t.name, name));
    if (!tag) {
      try {
        tag = await apiPost('/tags', { name });
        existing.push(tag);
      } catch (e) {
        if (e.code === 'conflict') {
          // race — re-read
          const fresh = await apiGet('/tags');
          tag = fresh.find((t) => lowerEq(t.name, name));
        }
        if (!tag) throw e;
      }
    }
    result.push(tag);
  }
  return result;
}

export function midpoint(prev, next) {
  if (!prev && !next) return 1000;
  if (!prev) return next.position - 1000;
  if (!next) return prev.position + 1000;
  return (prev.position + next.position) / 2;
}

function notFoundW(msg) { const e = new Error(msg); e.code = 'not_found'; return e; }
function ambiguousW(label, matches) {
  const e = new Error(`ambiguous_name: ${matches.length} ${label}s match: ${matches.map((m) => `id=${m.id} name="${m.name}"`).join(', ')}`);
  e.code = 'ambiguous_name';
  return e;
}

export async function resolveExercise({ exercise_id, exercise_name }) {
  if (exercise_id != null) {
    return apiGet(`/exercises/${exercise_id}`);
  }
  if (!exercise_name) throw new Error('either exercise_id or exercise_name required');
  const all = await apiGet('/exercises');
  const matches = all.filter((e) => lowerEq(e.name, exercise_name));
  if (matches.length === 0) throw notFoundW(`exercise "${exercise_name}" not found`);
  if (matches.length > 1) throw ambiguousW('exercise', matches);
  return matches[0];
}

export async function resolveRoutine({ routine_id, routine_name }) {
  if (routine_id != null) return apiGet(`/routines/${routine_id}`);
  if (!routine_name) throw new Error('either routine_id or routine_name required');
  const all = await apiGet('/routines');
  const matches = all.filter((r) => lowerEq(r.name, routine_name));
  if (matches.length === 0) throw notFoundW(`routine "${routine_name}" not found`);
  if (matches.length > 1) throw ambiguousW('routine', matches);
  return matches[0];
}

export async function resolveActiveWorkout() {
  try {
    const workout = await apiGet('/workouts/active');
    if (!workout) throw notFoundW('no active workout — call start_workout first');
    return workout;
  } catch (err) {
    if (err.code === 'not_found') {
      throw notFoundW('no active workout — call start_workout first');
    }
    throw err;
  }
}

// Find (or create) the workout_exercise for `exerciseId` within the active
// workout. Returns the workout_exercise object. Used by log_set.
export async function ensureWorkoutExercise(activeWorkout, exerciseId) {
  const existing = (activeWorkout.exercises || []).find((we) => we.exercise_id === exerciseId);
  if (existing) return existing;
  const { apiPost } = await import('./api.js');
  return apiPost(`/workouts/${activeWorkout.id}/exercises`, { exercise_id: exerciseId });
}
