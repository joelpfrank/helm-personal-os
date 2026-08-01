import React, { useState } from 'react';
import { useCoachStore } from '../../state/coach.js';

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

function Field({ label, hint, value, onSave, rows = 4 }) {
  const [draft, setDraft] = useState(value || '');
  const [editing, setEditing] = useState(false);
  React.useEffect(() => { setDraft(value || ''); }, [value]);

  async function commit() {
    setEditing(false);
    if (draft === (value || '')) return;
    await onSave(draft);
  }

  return (
    <div className="vision-field">
      <div className="vision-field-head">
        <h4>{label}</h4>
        {!editing && <button type="button" className="muted small" aria-expanded={editing} onClick={() => setEditing(true)}>edit</button>}
      </div>
      {hint && <p className="muted small">{hint}</p>}
      {editing ? (
        <>
          <textarea
            autoFocus
            rows={rows}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            placeholder={hint}
          />
          <div className="vision-field-actions">
            <button type="button" onClick={() => { setDraft(value || ''); setEditing(false); }}>cancel</button>
            <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={commit}>save</button>
          </div>
        </>
      ) : (
        value
          ? <div className="vision-field-value">{value}</div>
          : <p className="muted small empty-state">— not set yet —</p>
      )}
    </div>
  );
}

export default function VisionPanel() {
  const vision = useCoachStore((s) => s.vision);
  const saveVision = useCoachStore((s) => s.saveVision);
  const markReviewed = useCoachStore((s) => s.markVisionReviewed);
  if (!vision) return <p className="muted center-pad">loading…</p>;

  const since = daysAgo(vision.last_reviewed_at);

  return (
    <div className="vision-panel">
      <header className="vision-lead">
        <div className="today-kicker">Direction</div>
        <h3>Vision</h3>
        <p>Keep the long view legible. Helm uses this stored direction to connect today’s choices with the person you are becoming.</p>
      </header>
      <div className="vision-review" aria-live="polite">
        <div>
          <strong>Review rhythm</strong>
          <div className="muted small">
          {since == null
            ? 'Never reviewed yet — open the Chat tab and say "let\'s do my vision review".'
            : `Last reviewed ${since === 0 ? 'today' : `${since}d ago`}`}
          </div>
        </div>
        {since != null && <button type="button" onClick={() => markReviewed()}>Mark reviewed</button>}
      </div>

      <Field
        label="North star"
        hint="Who are you becoming? Write the 5-10 year narrative in your own voice. Markdown welcome."
        value={vision.north_star}
        rows={8}
        onSave={(v) => saveVision({ north_star: v })}
      />
      <Field
        label="Identity statement"
        hint='"I am the kind of person who…" — short, present tense, identity-based.'
        value={vision.identity_statement}
        rows={3}
        onSave={(v) => saveVision({ identity_statement: v })}
      />
      <Field
        label="Values"
        hint="The non-negotiables. One per line."
        value={vision.values}
        rows={5}
        onSave={(v) => saveVision({ values: v })}
      />
    </div>
  );
}
