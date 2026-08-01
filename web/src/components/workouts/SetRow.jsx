import React, { useState, useRef, useEffect } from 'react';

// One row in the active-workout exercise card. Handles both lifting
// (weight × reps × RPE) and cardio (time × distance × RPE) via the
// `kind` prop. Inputs use inputMode to summon iOS numeric keyboards.

function secondsToMmSs(s) {
  if (s == null || !Number.isFinite(s) || s < 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function mmSsToSeconds(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (t.includes(':')) {
    const [m, sec] = t.split(':');
    const M = Number(m), S = Number(sec);
    if (!Number.isFinite(M) || !Number.isFinite(S)) return null;
    return Math.round(M * 60 + S);
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export default function SetRow({
  set, prev, index, kind, onEdit, onComplete, onDelete,
}) {
  const completed = !!set.completed;
  const [weight, setWeight] = useState(set.weight_kg ?? '');
  const [reps, setReps] = useState(set.reps ?? '');
  const [time, setTime] = useState(secondsToMmSs(set.time_seconds));
  const [distance, setDistance] = useState(set.distance_m ?? '');
  const [rpe, setRpe] = useState(set.rpe ?? '');

  useEffect(() => { setWeight(set.weight_kg ?? ''); }, [set.weight_kg]);
  useEffect(() => { setReps(set.reps ?? ''); }, [set.reps]);
  useEffect(() => { setTime(secondsToMmSs(set.time_seconds)); }, [set.time_seconds]);
  useEffect(() => { setDistance(set.distance_m ?? ''); }, [set.distance_m]);
  useEffect(() => { setRpe(set.rpe ?? ''); }, [set.rpe]);

  function commit(field, value) {
    onEdit(field, value);
  }

  function fillFromPrev() {
    if (!prev) return;
    const patch = {};
    if (kind === 'lifting') {
      if (prev.weight_kg != null) { patch.weight_kg = prev.weight_kg; setWeight(prev.weight_kg); }
      if (prev.reps != null) { patch.reps = prev.reps; setReps(prev.reps); }
    } else {
      if (prev.time_seconds != null) { patch.time_seconds = prev.time_seconds; setTime(secondsToMmSs(prev.time_seconds)); }
      if (prev.distance_m != null) { patch.distance_m = prev.distance_m; setDistance(prev.distance_m); }
    }
    onEdit(patch);
  }

  const prevHint = kind === 'lifting' && prev
    ? `${prev.weight_kg ?? '?'}×${prev.reps ?? '?'}${prev.rpe ? ` @${prev.rpe}` : ''}`
    : kind === 'cardio' && prev
    ? `${secondsToMmSs(prev.time_seconds)} / ${prev.distance_m ? `${prev.distance_m}m` : ''}`
    : '';

  return (
    <div className={`set-row${completed ? ' completed' : ''}${set.is_warmup ? ' warmup' : ''}`}>
      <div className="set-row-num">{index + 1}</div>
      <button
        type="button"
        className="set-row-prev"
        onClick={fillFromPrev}
        disabled={!prev}
        title={prev ? 'tap to fill from last session' : 'no previous'}
      >{prevHint || '—'}</button>

      {kind === 'lifting' ? (
        <>
          <input
            type="text"
            inputMode="decimal"
            placeholder="kg"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onBlur={() => commit('weight_kg', weight === '' ? null : Number(weight))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="set-input set-input-w"
          />
          <span className="set-x">×</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="reps"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onBlur={() => commit('reps', reps === '' ? null : Number(reps))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="set-input set-input-r"
          />
        </>
      ) : (
        <>
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm:ss"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={() => commit('time_seconds', mmSsToSeconds(time))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="set-input set-input-w"
          />
          <span className="set-x">/</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="m"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            onBlur={() => commit('distance_m', distance === '' ? null : Number(distance))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="set-input set-input-r"
          />
        </>
      )}

      <input
        type="text"
        inputMode="decimal"
        placeholder="RPE"
        value={rpe}
        onChange={(e) => setRpe(e.target.value)}
        onBlur={() => commit('rpe', rpe === '' ? null : Number(rpe))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="set-input set-input-rpe"
      />

      <button
        type="button"
        className={`set-check${completed ? ' on' : ''}`}
        onClick={() => onComplete(!completed)}
        aria-pressed={completed}
        aria-label={completed ? 'Mark set incomplete' : 'Mark set complete'}
        title={completed ? 'mark incomplete' : 'mark complete'}
      >✓</button>

      <button
        type="button"
        className="set-del"
        onClick={() => onDelete()}
        aria-label="delete set"
        title="delete"
      >×</button>
    </div>
  );
}
