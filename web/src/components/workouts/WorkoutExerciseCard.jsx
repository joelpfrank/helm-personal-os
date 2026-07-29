import React from 'react';
import { useWorkoutsStore } from '../../state/workouts.js';
import SetRow from './SetRow.jsx';

export default function WorkoutExerciseCard({ we, prevSession, onShowHistory, onRemove, actions }) {
  // For the active workout, default to the live store actions. For a
  // historic-workout edit, the parent passes an `actions` object whose
  // calls speak to that workout's local state instead.
  const storeAddSet = useWorkoutsStore((s) => s.addSet);
  const storeEditSet = useWorkoutsStore((s) => s.editSet);
  const storeCompleteSet = useWorkoutsStore((s) => s.completeSet);
  const storeDeleteSet = useWorkoutsStore((s) => s.deleteSet);
  const addSet = actions?.addSet ?? storeAddSet;
  const editSet = actions?.editSet ?? storeEditSet;
  const completeSet = actions?.completeSet ?? storeCompleteSet;
  const deleteSet = actions?.deleteSet ?? storeDeleteSet;

  const kind = we.exercise?.kind || 'lifting';

  async function handleAddSet() {
    // Auto-fill from the last set in this exercise, or from the previous session.
    const lastSet = we.sets?.[we.sets.length - 1];
    const seed = lastSet || (prevSession?.sets?.[we.sets?.length] ?? null);
    const fields = {};
    if (seed) {
      if (kind === 'lifting') {
        if (seed.weight_kg != null) fields.weight_kg = seed.weight_kg;
        if (seed.reps != null) fields.reps = seed.reps;
      } else {
        if (seed.time_seconds != null) fields.time_seconds = seed.time_seconds;
        if (seed.distance_m != null) fields.distance_m = seed.distance_m;
      }
    }
    await addSet(we.id, fields);
  }

  return (
    <div className="workout-exercise-card">
      <div className="we-header">
        <button type="button" className="we-name-btn" onClick={onShowHistory}>
          {we.exercise?.name || `Exercise ${we.exercise_id}`}
          {kind === 'cardio' && <span className="we-kind-tag">cardio</span>}
        </button>
        <button type="button" className="we-remove" onClick={onRemove} aria-label="remove exercise">×</button>
      </div>

      <div className="set-list">
        {(we.sets || []).map((s, i) => (
          <SetRow
            key={s.id}
            set={s}
            prev={prevSession?.sets?.[i]}
            index={i}
            kind={kind}
            onEdit={(fieldOrPatch, value) => {
              const patch = typeof fieldOrPatch === 'string'
                ? { [fieldOrPatch]: value }
                : fieldOrPatch;
              editSet(s.id, patch).catch(() => {});
            }}
            onComplete={(toComplete) => {
              if (toComplete) completeSet(s.id).catch(() => {});
              else editSet(s.id, { completed: false }).catch(() => {});
            }}
            onDelete={() => {
              if (window.confirm('delete this set?')) deleteSet(s.id).catch(() => {});
            }}
          />
        ))}
        <button type="button" className="set-add" onClick={handleAddSet}>+ set</button>
      </div>
    </div>
  );
}
