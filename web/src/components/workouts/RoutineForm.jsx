import React, { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useWorkoutsStore } from '../../state/workouts.js';
import { apiPatch } from '../../api.js';
import ExercisePicker from './ExercisePicker.jsx';

// Same pattern as Board.jsx: assign positions on the number line and
// drop new items at the midpoint between neighbours so we never have to
// renumber the whole list.
function midpoint(prev, next) {
  if (!prev && !next) return 1000;
  if (!prev) return next.position - 1000;
  if (!next) return prev.position + 1000;
  return (prev.position + next.position) / 2;
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
      <circle cx="5" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/>
      <circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/>
      <circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/>
    </svg>
  );
}

function LinkIcon({ broken }) {
  return broken ? (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M6 9 L4 11 a2.5 2.5 0 0 1 -3.5 -3.5 L 2.5 5.5" />
      <path d="M10 7 L12 5 a2.5 2.5 0 0 1 3.5 3.5 L13.5 10.5" />
      <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M6 9 L4 11 a2.5 2.5 0 0 1 -3.5 -3.5 L 2.5 5.5" />
      <path d="M10 7 L12 5 a2.5 2.5 0 0 1 3.5 3.5 L13.5 10.5" />
      <line x1="6" y1="10" x2="10" y2="6" />
    </svg>
  );
}

function SortableExerciseRow({ re, kind, name, index, linkedUp, linkedDown, canLink, onCommit, onRemove, onToggleLink }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `re-${re.id}`,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const commitOnEnter = (e) => { if (e.key === 'Enter') e.target.blur(); };
  const groupCls = [
    linkedUp || linkedDown ? 'in-superset' : '',
    linkedUp ? 'linked-up' : '',
    linkedDown ? 'linked-down' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={setNodeRef} style={style} className={`re-row ${groupCls}`}>
      <button
        type="button"
        className="re-drag"
        aria-label="drag to reorder"
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>
      {canLink ? (
        <button
          type="button"
          className={`re-link ${linkedUp ? 'on' : ''}`}
          onClick={() => onToggleLink(index)}
          title={linkedUp ? 'unlink from previous exercise' : 'superset with previous exercise'}
          aria-label={linkedUp ? 'unlink from previous' : 'superset with previous'}
        >
          <LinkIcon broken={!linkedUp} />
        </button>
      ) : (
        <span className="re-link-spacer" aria-hidden />
      )}
      <span className="re-name">{name}</span>
      <input
        key={`sets-${re.id}-${re.target_sets ?? ''}`}
        type="number" min="1" placeholder="sets"
        defaultValue={re.target_sets ?? ''}
        onBlur={(e) => onCommit(re, 'target_sets', e.target.value)}
        onKeyDown={commitOnEnter}
        style={{ width: 50 }}
      />
      {kind === 'lifting' ? (
        <>
          <input
            key={`reps-${re.id}-${re.target_reps ?? ''}`}
            type="number" placeholder="reps"
            defaultValue={re.target_reps ?? ''}
            onBlur={(e) => onCommit(re, 'target_reps', e.target.value)}
            onKeyDown={commitOnEnter}
            style={{ width: 60 }}
          />
          <input
            key={`weight-${re.id}-${re.target_weight ?? ''}`}
            type="number" placeholder="kg" step="2.5"
            defaultValue={re.target_weight ?? ''}
            onBlur={(e) => onCommit(re, 'target_weight', e.target.value)}
            onKeyDown={commitOnEnter}
            style={{ width: 70 }}
          />
        </>
      ) : (
        <>
          <input
            key={`sec-${re.id}-${re.target_time_seconds ?? ''}`}
            type="number" placeholder="sec"
            defaultValue={re.target_time_seconds ?? ''}
            onBlur={(e) => onCommit(re, 'target_time_seconds', e.target.value)}
            onKeyDown={commitOnEnter}
            style={{ width: 70 }}
          />
          <input
            key={`dist-${re.id}-${re.target_distance_m ?? ''}`}
            type="number" placeholder="m"
            defaultValue={re.target_distance_m ?? ''}
            onBlur={(e) => onCommit(re, 'target_distance_m', e.target.value)}
            onKeyDown={commitOnEnter}
            style={{ width: 70 }}
          />
        </>
      )}
      <button
        type="button"
        className="re-del"
        onClick={() => onRemove(re.id)}
        aria-label="remove"
      >×</button>
    </div>
  );
}

export default function RoutineForm({ initial, onClose, onSave, onDelete }) {
  const isEdit = Boolean(initial?.id);
  const exercises = useWorkoutsStore((s) => s.exercises);
  const fetchExercises = useWorkoutsStore((s) => s.fetchExercises);
  const addExerciseToRoutine = useWorkoutsStore((s) => s.addExerciseToRoutine);
  const removeRoutineExercise = useWorkoutsStore((s) => s.removeRoutineExercise);
  const moveRoutineExercise = useWorkoutsStore((s) => s.moveRoutineExercise);
  // Subscribe to the live routine so newly-added exercises (and saved
  // sets/reps/weight) appear without needing the modal to be re-opened.
  // The `initial` prop is a one-shot snapshot from the parent and goes
  // stale the moment the store refreshes.
  const liveRoutine = useWorkoutsStore((s) =>
    initial?.id ? s.routines.find((r) => r.id === initial.id) : null,
  );
  const current = liveRoutine || initial;
  const [name, setName] = useState(initial?.name || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // 200ms long-press on touch so dragging doesn't fight with scroll/tap
    // on a phone, and inputs in the same row stay focusable.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  useEffect(() => { fetchExercises().catch(() => {}); }, [fetchExercises]);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = current?.exercises || [];
  const rowIds = rows.map((re) => `re-${re.id}`);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), notes });
      onClose();
    } finally { setSaving(false); }
  }

  async function addPickedExercise(picked) {
    if (!isEdit) {
      // Pre-create: append to in-memory list and re-save? Simpler: caller creates routine, then adds exercises.
      // For UX simplicity: create the routine immediately if missing.
      const r = await onSave({ name: name.trim() || 'New routine', notes });
      await addExerciseToRoutine(r.id, { exercise_id: picked.id });
      return;
    }
    await addExerciseToRoutine(initial.id, { exercise_id: picked.id });
  }

  // Save on blur (or Enter) rather than on every keystroke. Controlled
  // inputs + per-keystroke PATCH + parent refetch caused React to overwrite
  // the user's in-progress typing on re-render — so the inputs are now
  // uncontrolled (defaultValue) and only sync to the server when the field
  // is committed.
  async function commitTarget(re, field, raw) {
    const parsed = raw === '' || raw == null ? null : Number(raw);
    if (parsed !== null && Number.isNaN(parsed)) return;
    if (re[field] === parsed) return;
    await apiPatch(`/routines/exercise/${re.id}`, { [field]: parsed });
    await useWorkoutsStore.getState().fetchRoutines();
  }

  // Group IDs are arbitrary positive ints, unique-per-routine. We just take
  // the next free number in this routine when starting a new group.
  function nextGroupId() {
    const max = rows.reduce((m, r) => Math.max(m, r.superset_group || 0), 0);
    return max + 1;
  }

  async function toggleLink(idx) {
    if (idx === 0) return;
    const row = rows[idx];
    const prev = rows[idx - 1];
    const isLinkedUp = row.superset_group != null && row.superset_group === prev.superset_group;
    if (isLinkedUp) {
      const groupId = row.superset_group;
      await apiPatch(`/routines/exercise/${row.id}`, { superset_group: null });
      // Tidy: if prev is now the only remaining member of the group, clear
      // its tag too so a lone row never appears with the superset bracket.
      const remaining = rows.filter((r, i) => i !== idx && r.superset_group === groupId);
      if (remaining.length === 1) {
        await apiPatch(`/routines/exercise/${remaining[0].id}`, { superset_group: null });
      }
    } else {
      let groupId = prev.superset_group;
      if (groupId == null) {
        groupId = nextGroupId();
        await apiPatch(`/routines/exercise/${prev.id}`, { superset_group: groupId });
      }
      await apiPatch(`/routines/exercise/${row.id}`, { superset_group: groupId });
    }
    await useWorkoutsStore.getState().fetchRoutines();
  }

  function onDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = rows.findIndex((r) => `re-${r.id}` === active.id);
    const newIdx = rows.findIndex((r) => `re-${r.id}` === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const target = rows[newIdx];
    const sibling = oldIdx < newIdx ? rows[newIdx + 1] : rows[newIdx - 1];
    const [prev, next] = oldIdx < newIdx ? [target, sibling] : [sibling, target];
    const reId = rows[oldIdx].id;
    moveRoutineExercise(reId, midpoint(prev, next)).catch(() => {});
  }

  async function remove() {
    if (!window.confirm(`delete routine "${name}"?`)) return;
    await onDelete();
    onClose();
  }

  function exerciseName(exId) {
    return exercises.find((e) => e.id === exId)?.name || `Exercise ${exId}`;
  }
  function exerciseKind(exId) {
    return exercises.find((e) => e.id === exId)?.kind || 'lifting';
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal routine-form" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{isEdit ? 'Edit routine' : 'New routine'}</h3>

        <div className="modal-row">
          <label>name</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Push A, Pull B, Leg day"
            style={{ flex: 1 }}
          />
        </div>
        <div className="modal-row stretch">
          <label>notes</label>
          <textarea
            className="notes-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ flex: 1 }}
          />
        </div>

        {isEdit && (
          <div className="routine-exercises">
            <h4 className="modal-heading" style={{ marginTop: 8 }}>Exercises</h4>
            {rows.length === 0 && <p className="muted small">no exercises in this routine.</p>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                {rows.map((re, i) => {
                  const prev = rows[i - 1];
                  const next = rows[i + 1];
                  const linkedUp = i > 0 && re.superset_group != null && prev.superset_group === re.superset_group;
                  const linkedDown = i < rows.length - 1 && re.superset_group != null && next.superset_group === re.superset_group;
                  return (
                    <SortableExerciseRow
                      key={re.id}
                      re={re}
                      kind={exerciseKind(re.exercise_id)}
                      name={exerciseName(re.exercise_id)}
                      index={i}
                      linkedUp={linkedUp}
                      linkedDown={linkedDown}
                      canLink={i > 0}
                      onCommit={commitTarget}
                      onRemove={removeRoutineExercise}
                      onToggleLink={toggleLink}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
            <button type="button" className="re-add" onClick={() => setPicking(true)}>+ add exercise</button>
          </div>
        )}

        <div className="modal-actions">
          {isEdit && onDelete && <button type="button" className="danger" onClick={remove}>delete</button>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>{isEdit ? 'done' : 'cancel'}</button>
          {!isEdit && (
            <button type="button" onClick={save} disabled={saving || !name.trim()}>
              {saving ? 'saving…' : 'create'}
            </button>
          )}
        </div>

        {picking && (
          <ExercisePicker
            onClose={() => setPicking(false)}
            onPick={addPickedExercise}
          />
        )}
      </div>
    </div>
  );
}
