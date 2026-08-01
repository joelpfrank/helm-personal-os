import React, { useEffect, useState } from 'react';

// `datetime-local` inputs use local-timezone strings without a Z suffix
// like "2026-05-14T14:30". We convert to/from ISO when storing.

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local) {
  if (!local) return null;
  // Treat the input as local wall time and convert to ISO with timezone.
  const d = new Date(local);
  if (Number.isNaN(+d)) return null;
  return d.toISOString();
}
function toDateInput(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}
function fromDateInput(date) {
  if (!date) return null;
  return `${date}T00:00:00.000Z`;
}

export default function EventForm({ initial, onClose, onSave, onDelete }) {
  const isEdit = Boolean(initial?.id);
  const [summary, setSummary] = useState(initial?.summary || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [allDay, setAllDay] = useState(initial?.all_day ? true : false);
  const [start, setStart] = useState(
    initial?.start_at
      ? (initial.all_day ? toDateInput(initial.start_at) : toLocalInput(initial.start_at))
      : (() => {
          const d = new Date();
          d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
          return toLocalInput(d.toISOString());
        })()
  );
  const [end, setEnd] = useState(
    initial?.end_at
      ? (initial.all_day ? toDateInput(initial.end_at) : toLocalInput(initial.end_at))
      : ''
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // When user toggles all-day, reformat inputs.
  useEffect(() => {
    if (!start) return;
    if (allDay && start.includes('T')) setStart(start.slice(0, 10));
    if (!allDay && !start.includes('T')) setStart(start + 'T09:00');
    if (end) {
      if (allDay && end.includes('T')) setEnd(end.slice(0, 10));
      if (!allDay && !end.includes('T')) setEnd(end + 'T10:00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDay]);

  async function save() {
    if (!summary.trim() || !start) return;
    setSaving(true);
    try {
      const startIso = allDay ? fromDateInput(start) : fromLocalInput(start);
      const endIso = end
        ? (allDay ? fromDateInput(end) : fromLocalInput(end))
        : null;
      const fields = {
        summary: summary.trim(),
        description,
        location,
        all_day: allDay,
        start_at: startIso,
      };
      if (endIso) fields.end_at = endIso;
      await onSave(fields);
      onClose();
    } catch (err) {
      window.alert(err.message || 'save failed');
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm(`Delete "${summary}"? This also removes it from Google Calendar (and therefore Apple Calendar).`)) return;
    await onDelete();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{isEdit ? 'Edit event' : 'New event'}</h3>

        <div className="modal-row">
          <label>title</label>
          <input
            type="text"
            autoFocus
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Lunch with Sam"
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-row">
          <label>start</label>
          <input
            type={allDay ? 'date' : 'datetime-local'}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-row">
          <label>end</label>
          <input
            type={allDay ? 'date' : 'datetime-local'}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={{ flex: 1 }}
            placeholder={allDay ? 'optional' : 'optional (defaults to start + 1h)'}
          />
        </div>

        <div className="modal-row">
          <label>all day</label>
          <label className="checkbox-label">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span className="muted small">no specific time</span>
          </label>
        </div>

        <div className="modal-row">
          <label>where</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="optional"
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-row stretch">
          <label>notes</label>
          <textarea
            className="notes-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="optional details, links, agenda…"
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-actions">
          {isEdit && onDelete && (
            <button type="button" className="danger" onClick={remove}>delete</button>
          )}
          <span style={{ flex: 1 }} />
          {isEdit && initial?.html_link && (
            <a href={initial.html_link} target="_blank" rel="noreferrer" className="muted small">
              open in Google
            </a>
          )}
          <button type="button" onClick={onClose}>cancel</button>
          <button type="button" onClick={save} disabled={saving || !summary.trim()}>
            {saving ? 'saving…' : (isEdit ? 'save' : 'create')}
          </button>
        </div>
      </div>
    </div>
  );
}
