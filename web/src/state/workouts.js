import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../api.js';

export const useWorkoutsStore = create((set, get) => ({
  exercises: [],
  routines: [],
  active: null,
  history: [],
  statsByExercise: {},
  loading: false,
  error: null,

  // ---------- catalog ----------
  async fetchExercises({ includeArchived } = {}) {
    try {
      const qs = includeArchived ? '?include=archived' : '';
      const exercises = await apiGet(`/exercises${qs}`);
      set({ exercises, error: null });
      return exercises;
    } catch (err) { set({ error: err.message }); throw err; }
  },
  async createExercise(fields) {
    const ex = await apiPost('/exercises', fields);
    await get().fetchExercises();
    return ex;
  },
  async editExercise(id, patch) {
    const ex = await apiPatch(`/exercises/${id}`, patch);
    await get().fetchExercises();
    return ex;
  },
  async deleteExercise(id) {
    try {
      await apiDelete(`/exercises/${id}`);
      await get().fetchExercises();
    } catch (err) {
      if (err.status === 409) {
        // Surface as a friendly error; caller can offer archive instead.
        set({ error: err.message });
      }
      throw err;
    }
  },
  async fetchExerciseStats(id) {
    try {
      const stats = await apiGet(`/exercises/${id}/stats`);
      set((s) => ({ statsByExercise: { ...s.statsByExercise, [id]: stats } }));
      return stats;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  // ---------- routines ----------
  async fetchRoutines({ includeArchived } = {}) {
    try {
      const qs = includeArchived ? '?include=archived' : '';
      const routines = await apiGet(`/routines${qs}`);
      set({ routines });
      return routines;
    } catch (err) { set({ error: err.message }); throw err; }
  },
  async createRoutine(fields) {
    const r = await apiPost('/routines', fields);
    await get().fetchRoutines();
    return r;
  },
  async editRoutine(id, patch) {
    const r = await apiPatch(`/routines/${id}`, patch);
    await get().fetchRoutines();
    return r;
  },
  async deleteRoutine(id) {
    await apiDelete(`/routines/${id}`);
    await get().fetchRoutines();
  },
  async addExerciseToRoutine(routineId, fields) {
    const re = await apiPost(`/routines/${routineId}/exercises`, fields);
    await get().fetchRoutines();
    return re;
  },
  async removeRoutineExercise(reId) {
    await apiDelete(`/routines/exercise/${reId}`);
    await get().fetchRoutines();
  },
  async moveRoutineExercise(reId, position) {
    await apiPatch(`/routines/exercise/${reId}`, { position });
    await get().fetchRoutines();
  },

  // ---------- workouts ----------
  async fetchActive() {
    try {
      const w = await apiGet('/workouts/active');
      set({ active: w });
      return w;
    } catch (err) {
      if (err.status === 404) { set({ active: null }); return null; }
      set({ error: err.message });
      throw err;
    }
  },
  async startWorkout(fields = {}) {
    const w = await apiPost('/workouts', fields);
    set({ active: w });
    return w;
  },
  async endWorkout() {
    const cur = get().active;
    if (!cur) return null;
    const w = await apiPost(`/workouts/${cur.id}/end`, {});
    set({ active: null });
    await get().fetchHistory();
    return w;
  },
  async cancelWorkout() {
    const cur = get().active;
    if (!cur) return;
    await apiDelete(`/workouts/${cur.id}`);
    set({ active: null });
    await get().fetchHistory();
  },
  async fetchHistory({ from, to, limit = 50 } = {}) {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', String(limit));
      const history = await apiGet(`/workouts?${params.toString()}`);
      set({ history });
      return history;
    } catch (err) { set({ error: err.message }); throw err; }
  },
  async fetchWorkout(id) {
    return apiGet(`/workouts/${id}`);
  },

  // workout_exercises
  async addExerciseToWorkout(workoutId, exerciseId) {
    const we = await apiPost(`/workouts/${workoutId}/exercises`, { exercise_id: exerciseId });
    await get().fetchActive();
    return we;
  },
  async removeWorkoutExercise(weId) {
    await apiDelete(`/workouts/exercise/${weId}`);
    await get().fetchActive();
  },

  // sets — optimistic for fast in-gym feel
  async addSet(weId, fields = {}) {
    const before = get().active;
    // optimistic: append a temp set
    const tempId = -Date.now();
    const tempSet = { id: tempId, workout_exercise_id: weId, position: 9999, completed: 0, is_warmup: 0, note: '', ...fields, weight_kg: fields.weight_kg ?? null, reps: fields.reps ?? null, time_seconds: fields.time_seconds ?? null, distance_m: fields.distance_m ?? null, rpe: fields.rpe ?? null };
    set((s) => ({ active: applyOnSets(s.active, weId, (sets) => [...sets, tempSet]) }));
    try {
      const real = await apiPost(`/workouts/exercise/${weId}/sets`, fields);
      set((s) => ({ active: applyOnSets(s.active, weId, (sets) =>
        sets.map((x) => x.id === tempId ? real : x)
      ) }));
      return real;
    } catch (err) {
      set({ active: before, error: err.message });
      throw err;
    }
  },
  async editSet(setId, patch) {
    const before = get().active;
    set((s) => ({ active: mapSet(s.active, setId, (x) => ({ ...x, ...patch })) }));
    try {
      const updated = await apiPatch(`/workouts/sets/${setId}`, patch);
      set((s) => ({ active: mapSet(s.active, setId, () => updated) }));
      return updated;
    } catch (err) {
      set({ active: before, error: err.message });
      throw err;
    }
  },
  async completeSet(setId) {
    const before = get().active;
    set((s) => ({ active: mapSet(s.active, setId, (x) => ({ ...x, completed: 1 })) }));
    try {
      const updated = await apiPost(`/workouts/sets/${setId}/complete`, {});
      set((s) => ({ active: mapSet(s.active, setId, () => updated) }));
      return updated;
    } catch (err) {
      set({ active: before, error: err.message });
      throw err;
    }
  },
  async deleteSet(setId) {
    const before = get().active;
    set((s) => ({ active: removeSet(s.active, setId) }));
    try {
      await apiDelete(`/workouts/sets/${setId}`);
    } catch (err) {
      set({ active: before, error: err.message });
      throw err;
    }
  },
}));

// ---------- helpers ----------

function applyOnSets(active, weId, fn) {
  if (!active) return active;
  return {
    ...active,
    exercises: active.exercises.map((we) =>
      we.id === weId ? { ...we, sets: fn(we.sets || []) } : we,
    ),
  };
}

function mapSet(active, setId, fn) {
  if (!active) return active;
  return {
    ...active,
    exercises: active.exercises.map((we) => ({
      ...we,
      sets: (we.sets || []).map((s) => s.id === setId ? fn(s) : s),
    })),
  };
}

function removeSet(active, setId) {
  if (!active) return active;
  return {
    ...active,
    exercises: active.exercises.map((we) => ({
      ...we,
      sets: (we.sets || []).filter((s) => s.id !== setId),
    })),
  };
}
