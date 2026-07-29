import React, { useEffect, useState } from 'react';
import { useWorkoutsStore } from '../../state/workouts.js';

export default function ExercisePicker({ onClose, onPick }) {
  const exercises = useWorkoutsStore((s) => s.exercises);
  const fetchExercises = useWorkoutsStore((s) => s.fetchExercises);
  const createExercise = useWorkoutsStore((s) => s.createExercise);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('lifting');

  useEffect(() => { fetchExercises().catch(() => {}); }, [fetchExercises]);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = exercises.filter((e) => {
    if (e.archived_at) return false;
    if (!q.trim()) return true;
    const ql = q.toLowerCase();
    return e.name.toLowerCase().includes(ql) || e.muscle_group.toLowerCase().includes(ql);
  });

  const exact = filtered.find((e) => e.name.toLowerCase() === q.trim().toLowerCase());

  async function handleCreate() {
    if (!q.trim()) return;
    const created = await createExercise({ name: q.trim(), kind });
    onPick(created);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal exercise-picker" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">Pick an exercise</h3>
        <input
          type="text"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search by name or muscle group…"
          style={{ width: '100%' }}
        />
        <div className="picker-list">
          {filtered.length === 0 && q.trim() && (
            <div className="picker-empty">
              <p className="muted">no exercise named "{q.trim()}"</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>kind:</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="lifting">lifting</option>
                  <option value="cardio">cardio</option>
                </select>
                <button type="button" onClick={handleCreate} style={{ marginLeft: 'auto' }}>
                  + create "{q.trim()}"
                </button>
              </div>
            </div>
          )}
          {filtered.map((e) => (
            <button
              key={e.id}
              type="button"
              className="picker-item"
              onClick={() => { onPick(e); onClose(); }}
            >
              <span className="picker-item-name">{e.name}</span>
              <span className="picker-item-meta">{e.kind}{e.muscle_group ? ` · ${e.muscle_group}` : ''}</span>
            </button>
          ))}
          {!q.trim() && filtered.length === 0 && (
            <p className="muted center-pad">no exercises yet — type a name to create one.</p>
          )}
        </div>
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>cancel</button>
        </div>
      </div>
    </div>
  );
}
