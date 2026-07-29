import React, { useEffect, useState } from 'react';
import { useWorkoutsStore } from '../state/workouts.js';
import { getHashParam, writeHashParams, onHashChange } from '../lib/hash.js';
import ActiveWorkout from '../components/workouts/ActiveWorkout.jsx';
import ExerciseForm from '../components/workouts/ExerciseForm.jsx';
import ExerciseHistory from '../components/workouts/ExerciseHistory.jsx';
import RoutineForm from '../components/workouts/RoutineForm.jsx';
import WorkoutExerciseCard from '../components/workouts/WorkoutExerciseCard.jsx';
import ExercisePicker from '../components/workouts/ExercisePicker.jsx';
import { apiPost, apiPatch, apiDelete } from '../api.js';

const TABS = ['active', 'history', 'routines', 'exercises'];

// Render the comma-separated exercise summary under a routine card,
// joining contiguous superset members with ' + ' so a routine like
// (Burpees + Pull-ups) · Squats reads at a glance.
function renderRoutineExerciseSummary(reRows, allExercises) {
  const name = (id) => allExercises.find((e) => e.id === id)?.name || `Exercise ${id}`;
  const parts = [];
  let i = 0;
  while (i < reRows.length) {
    const re = reRows[i];
    const group = re.superset_group;
    if (group != null) {
      const members = [name(re.exercise_id)];
      let j = i + 1;
      while (j < reRows.length && reRows[j].superset_group === group) {
        members.push(name(reRows[j].exercise_id));
        j++;
      }
      parts.push(members.join(' + '));
      i = j;
    } else {
      parts.push(name(re.exercise_id));
      i++;
    }
  }
  return parts.join(' · ');
}

function readTab() {
  const t = getHashParam('wo');
  return TABS.includes(t) ? t : 'active';
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDuration(start, end) {
  if (!start) return '';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, b - a);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function WorkoutsView() {
  const active = useWorkoutsStore((s) => s.active);
  const history = useWorkoutsStore((s) => s.history);
  const exercises = useWorkoutsStore((s) => s.exercises);
  const routines = useWorkoutsStore((s) => s.routines);
  const error = useWorkoutsStore((s) => s.error);
  const fetchActive = useWorkoutsStore((s) => s.fetchActive);
  const fetchHistory = useWorkoutsStore((s) => s.fetchHistory);
  const fetchExercises = useWorkoutsStore((s) => s.fetchExercises);
  const fetchRoutines = useWorkoutsStore((s) => s.fetchRoutines);
  const startWorkout = useWorkoutsStore((s) => s.startWorkout);
  const createExercise = useWorkoutsStore((s) => s.createExercise);
  const editExercise = useWorkoutsStore((s) => s.editExercise);
  const deleteExercise = useWorkoutsStore((s) => s.deleteExercise);
  const createRoutine = useWorkoutsStore((s) => s.createRoutine);
  const editRoutine = useWorkoutsStore((s) => s.editRoutine);
  const deleteRoutine = useWorkoutsStore((s) => s.deleteRoutine);
  const fetchWorkout = useWorkoutsStore((s) => s.fetchWorkout);

  const [tab, setTab] = useState(readTab);
  const [exerciseForm, setExerciseForm] = useState(null);   // null | {} | exercise obj
  const [routineForm, setRoutineForm] = useState(null);     // null | {} | routine obj
  const [historyExercise, setHistoryExercise] = useState(null);
  const [pastWorkout, setPastWorkout] = useState(null);

  useEffect(() => {
    fetchActive().catch(() => {});
    fetchHistory().catch(() => {});
    fetchExercises().catch(() => {});
    fetchRoutines().catch(() => {});
    return onHashChange(() => setTab(readTab()));
  }, [fetchActive, fetchHistory, fetchExercises, fetchRoutines]);

  function switchTab(id) {
    writeHashParams({ wo: id });
    setTab(id);
  }

  async function handleStartFresh() {
    if (active) {
      window.alert(`A workout is already active (started ${fmtDate(active.started_at)}). Finish or cancel it on the Active tab first.`);
      switchTab('active');
      return;
    }
    const name = window.prompt('Workout name (optional):', '');
    if (name === null) return;
    await startWorkout({ name: name.trim() || undefined });
    switchTab('active');
  }

  async function handleStartFromRoutine(r) {
    if (active) {
      window.alert(`A workout is already active. Finish or cancel it first.`);
      switchTab('active');
      return;
    }
    await startWorkout({ routine_id: r.id });
    switchTab('active');
  }

  async function openPastWorkout(id) {
    const w = await fetchWorkout(id);
    setPastWorkout(w);
  }

  return (
    <div className="workouts-view">
      <div className="workouts-toolbar">
        <div className="workouts-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'on' : ''}
              onClick={() => switchTab(t)}
            >{t === 'active' && active ? 'Active ●' : t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {tab === 'active' && !active && <button type="button" onClick={handleStartFresh}>Start workout</button>}
        {tab === 'exercises' && <button type="button" onClick={() => setExerciseForm({})}>+ exercise</button>}
        {tab === 'routines' && <button type="button" onClick={() => setRoutineForm({})}>+ routine</button>}
        {error && <span className="err small">{error}</span>}
      </div>

      <div className="workouts-body">
        {tab === 'active' && (
          active ? <ActiveWorkout /> : (
            <div className="center-pad">
              <p className="muted">no active workout.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button type="button" onClick={handleStartFresh}>Start blank</button>
                {routines.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const r = routines.find((x) => String(x.id) === e.target.value);
                      if (r) handleStartFromRoutine(r);
                    }}
                  >
                    <option value="" disabled>Start from routine…</option>
                    {routines.filter((r) => !r.archived_at).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )
        )}

        {tab === 'history' && (
          <div className="history-list">
            {history.length === 0 ? (
              <p className="muted center-pad">no workouts yet.</p>
            ) : history.map((w) => (
              <button
                key={w.id}
                type="button"
                className="history-item"
                onClick={() => openPastWorkout(w.id)}
              >
                <div className="history-item-main">
                  <div className="history-item-name">{w.name || 'Workout'}</div>
                  <div className="muted small">{fmtDate(w.started_at)} · {fmtDuration(w.started_at, w.ended_at)}</div>
                </div>
                {!w.ended_at && <span className="history-active-tag">in progress</span>}
              </button>
            ))}
          </div>
        )}

        {tab === 'routines' && (
          <div className="routines-list">
            {routines.length === 0 ? (
              <p className="muted center-pad">no routines yet — click + routine to create one.</p>
            ) : routines.map((r) => (
              <div key={r.id} className="routine-card">
                <div className="routine-card-head">
                  <button type="button" className="routine-name-btn" onClick={() => setRoutineForm(r)}>
                    {r.name}
                  </button>
                  <span className="muted small">{r.exercises?.length || 0} exercises</span>
                  {!r.archived_at && (
                    <button type="button" className="routine-start-btn" onClick={() => handleStartFromRoutine(r)}>
                      Start
                    </button>
                  )}
                </div>
                {r.exercises?.length > 0 && (
                  <div className="routine-card-exercises muted small">
                    {renderRoutineExerciseSummary(r.exercises, exercises)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'exercises' && (
          <div className="exercises-list">
            {exercises.length === 0 ? (
              <p className="muted center-pad">no exercises yet — click + exercise to create one.</p>
            ) : exercises.map((e) => (
              <div key={e.id} className={`exercise-row${e.archived_at ? ' archived' : ''}`}>
                <button
                  type="button"
                  className="exercise-name-btn"
                  onClick={() => setHistoryExercise(e)}
                >
                  <span className="exercise-name">{e.name}</span>
                  <span className="exercise-meta muted small">{e.kind}{e.muscle_group ? ` · ${e.muscle_group}` : ''}</span>
                </button>
                <button type="button" className="exercise-edit" onClick={() => setExerciseForm(e)}>edit</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {exerciseForm && (
        <ExerciseForm
          initial={exerciseForm.id ? exerciseForm : null}
          onClose={() => setExerciseForm(null)}
          onSave={(fields) => exerciseForm.id ? editExercise(exerciseForm.id, fields) : createExercise(fields)}
          onDelete={exerciseForm.id ? () => deleteExercise(exerciseForm.id) : null}
        />
      )}

      {routineForm && (
        <RoutineForm
          initial={routineForm.id ? routineForm : null}
          onClose={() => { setRoutineForm(null); fetchRoutines(); }}
          onSave={async (fields) =>
            routineForm.id ? editRoutine(routineForm.id, fields) : createRoutine(fields)
          }
          onDelete={routineForm.id ? () => deleteRoutine(routineForm.id) : null}
        />
      )}

      {historyExercise && (
        <ExerciseHistory
          exercise={historyExercise}
          onClose={() => setHistoryExercise(null)}
          onEdit={() => { setExerciseForm(historyExercise); setHistoryExercise(null); }}
        />
      )}

      {pastWorkout && (
        <PastWorkoutModal workout={pastWorkout} onClose={() => setPastWorkout(null)} />
      )}
    </div>
  );
}

function PastWorkoutModal({ workout: initial, onClose }) {
  // Local mutable copy of the historic workout. Server endpoints for
  // set/exercise mutation don't gate on ended_at, so we can edit
  // freely; we just keep this local copy in sync rather than going
  // through the active-workout store.
  const [workout, setWorkout] = useState(initial);
  const [picking, setPicking] = useState(false);
  const fetchHistory = useWorkoutsStore((s) => s.fetchHistory);

  useEffect(() => { setWorkout(initial); }, [initial]);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function patchSet(setId, patch) {
    setWorkout((w) => ({
      ...w,
      exercises: w.exercises.map((we) => ({
        ...we,
        sets: we.sets.map((s) => s.id === setId ? { ...s, ...patch } : s),
      })),
    }));
  }

  const actions = {
    async addSet(weId, fields = {}) {
      const real = await apiPost(`/workouts/exercise/${weId}/sets`, fields);
      setWorkout((w) => ({
        ...w,
        exercises: w.exercises.map((we) => we.id === weId
          ? { ...we, sets: [...we.sets, real] }
          : we),
      }));
      return real;
    },
    async editSet(setId, patch) {
      patchSet(setId, patch);
      const updated = await apiPatch(`/workouts/sets/${setId}`, patch);
      patchSet(setId, updated);
      return updated;
    },
    async completeSet(setId) {
      patchSet(setId, { completed: 1 });
      const updated = await apiPost(`/workouts/sets/${setId}/complete`, {});
      patchSet(setId, updated);
      return updated;
    },
    async deleteSet(setId) {
      setWorkout((w) => ({
        ...w,
        exercises: w.exercises.map((we) => ({
          ...we,
          sets: we.sets.filter((s) => s.id !== setId),
        })),
      }));
      await apiDelete(`/workouts/sets/${setId}`);
    },
  };

  async function addExercise(exercise) {
    const we = await apiPost(`/workouts/${workout.id}/exercises`, { exercise_id: exercise.id });
    setWorkout((w) => ({ ...w, exercises: [...w.exercises, { ...we, exercise, sets: we.sets || [] }] }));
    setPicking(false);
  }

  async function removeExercise(weId) {
    if (!window.confirm('remove this exercise from the workout?')) return;
    await apiDelete(`/workouts/exercise/${weId}`);
    setWorkout((w) => ({ ...w, exercises: w.exercises.filter((we) => we.id !== weId) }));
  }

  function close() {
    // Refresh the history list so any newly-added exercises / sets show
    // up in PR stats etc. when the user navigates away.
    fetchHistory().catch(() => {});
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal past-workout-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{workout.name || 'Workout'}</h3>
        <div className="muted small" style={{ marginBottom: 8 }}>
          {fmtDate(workout.started_at)} · {fmtDuration(workout.started_at, workout.ended_at)}
          {workout.notes ? ` · ${workout.notes}` : ''}
        </div>
        <p className="muted small">edit reps, weight, sets, or add an exercise — changes are saved as you type.</p>
        {(workout.exercises || []).map((we) => (
          <WorkoutExerciseCard
            key={we.id}
            we={we}
            actions={actions}
            onShowHistory={() => {}}
            onRemove={() => removeExercise(we.id)}
          />
        ))}
        <button type="button" className="we-add" onClick={() => setPicking(true)}>+ exercise</button>
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={close}>done</button>
        </div>
        {picking && (
          <ExercisePicker onClose={() => setPicking(false)} onPick={addExercise} />
        )}
      </div>
    </div>
  );
}
