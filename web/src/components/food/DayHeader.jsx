import React from 'react';

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function ScoreChip({ score }) {
  let color = 'var(--danger)';
  let label = 'poor';
  if (score >= 70) { color = '#7ad988'; label = 'great'; }
  else if (score >= 40) { color = '#f5b945'; label = 'ok'; }
  return (
    <div className="food-score-chip" style={{ borderColor: color, color }}>
      <strong>{score}</strong>
      <span className="muted small" style={{ marginLeft: 4 }}>· {label}</span>
    </div>
  );
}

// Inline numeric input that saves on blur / Enter. Uncontrolled
// (defaultValue) so the optimistic refetch in the store doesn't fight
// the user's typing — same pattern as the routine editor.
function NumField({ label, unit, value, onCommit, step = 'any', min = 0 }) {
  const display = value == null ? '' : value;
  function onBlur(e) {
    const raw = e.target.value;
    const parsed = raw === '' ? null : Number(raw);
    if (parsed !== null && Number.isNaN(parsed)) return;
    if (parsed === value) return;
    onCommit(parsed);
  }
  return (
    <label className="food-num">
      <span className="muted small">{label}</span>
      <span className="food-num-row">
        <input
          key={`${label}-${display}`}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          defaultValue={display}
          onBlur={onBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        />
        {unit && <span className="food-num-unit muted">{unit}</span>}
      </span>
    </label>
  );
}

export default function DayHeader({ day, onPatch }) {
  return (
    <div className="food-day-header">
      <div className="food-day-title">
        <div className="food-day-date">{fmtDate(day.date)}</div>
        <ScoreChip score={day.score ?? 0} />
      </div>
      <div className="food-day-stats">
        <NumField
          label="weight"
          unit="kg"
          value={day.weight_kg}
          step="0.1"
          onCommit={(v) => onPatch({ weight_kg: v })}
        />
        <NumField
          label="steps"
          unit=""
          value={day.steps}
          step="1"
          onCommit={(v) => onPatch({ steps: v == null ? null : Math.round(v) })}
        />
        <NumField
          label="active cal"
          unit="kcal"
          value={day.active_calories}
          step="1"
          onCommit={(v) => onPatch({ active_calories: v == null ? null : Math.round(v) })}
        />
        <NumField
          label="exercise"
          unit="min"
          value={day.exercise_minutes}
          step="1"
          onCommit={(v) => onPatch({ exercise_minutes: v == null ? null : Math.round(v) })}
        />
      </div>
    </div>
  );
}
