import React, { useEffect, useState } from 'react';

export default function ExerciseForm({ initial, onClose, onSave, onDelete }) {
  const isEdit = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState(initial?.kind || 'lifting');
  const [muscle, setMuscle] = useState(initial?.muscle_group || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        kind,
        muscle_group: muscle.trim(),
        notes,
      });
      onClose();
    } finally { setSaving(false); }
  }

  async function archive() {
    await onSave({ archived: true });
    onClose();
  }
  async function unarchive() {
    await onSave({ archived: false });
    onClose();
  }
  async function remove() {
    if (!window.confirm(`Delete exercise "${name}"? If it has been used in any workout, the server will reject and tell you to archive instead.`)) return;
    try {
      await onDelete();
      onClose();
    } catch (err) {
      window.alert(err.message || 'delete failed');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{isEdit ? 'Edit exercise' : 'New exercise'}</h3>

        <div className="modal-row">
          <label>name</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bench Press, Squat, Run"
            style={{ flex: 1 }}
          />
        </div>
        <div className="modal-row">
          <label>kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="lifting">lifting (weight × reps)</option>
            <option value="cardio">cardio (time + distance)</option>
          </select>
        </div>
        <div className="modal-row">
          <label>muscle</label>
          <input
            type="text"
            value={muscle}
            onChange={(e) => setMuscle(e.target.value)}
            placeholder="chest, legs, back… (optional)"
            style={{ flex: 1 }}
          />
        </div>
        <div className="modal-row stretch">
          <label>notes</label>
          <textarea
            className="notes-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="form cues, equipment, links…"
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-actions">
          {isEdit && (
            <>
              <button type="button" className="danger" onClick={remove}>delete</button>
              {initial?.archived_at
                ? <button type="button" onClick={unarchive}>unarchive</button>
                : <button type="button" onClick={archive}>archive</button>}
            </>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>cancel</button>
          <button type="button" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'saving…' : (isEdit ? 'save' : 'create')}
          </button>
        </div>
      </div>
    </div>
  );
}
