import React, { useEffect, useState } from 'react';
import { useFoodStore } from '../../state/food.js';

function Row({ label, unit, value, step, onCommit }) {
  const [draft, setDraft] = useState(value == null ? '' : value);
  useEffect(() => { setDraft(value == null ? '' : value); }, [value]);
  function commit() {
    const parsed = draft === '' ? null : Number(draft);
    if (parsed !== null && Number.isNaN(parsed)) return;
    if (parsed === value) return;
    onCommit(parsed);
  }
  return (
    <div className="modal-row">
      <label>{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        style={{ width: 120 }}
      />
      {unit && <span className="muted small">{unit}</span>}
    </div>
  );
}

export default function FoodSettings() {
  const settings = useFoodStore((s) => s.settings);
  const fetchSettings = useFoodStore((s) => s.fetchSettings);
  const saveSettings = useFoodStore((s) => s.saveSettings);

  useEffect(() => { fetchSettings().catch(() => {}); }, [fetchSettings]);

  if (!settings) return <p className="muted center-pad">loading…</p>;

  function patch(p) { saveSettings(p).catch(() => {}); }

  return (
    <div className="food-settings">
      <h3 className="modal-heading">Daily targets</h3>
      <p className="muted small">Macros power the progress bars + the daily health score. Leave any field blank to skip that line in the UI.</p>
      <Row label="calories" unit="kcal" step="10"
        value={settings.calorie_target} onCommit={(v) => patch({ calorie_target: v == null ? null : Math.round(v) })} />
      <Row label="protein" unit="g" step="1"
        value={settings.protein_g_target} onCommit={(v) => patch({ protein_g_target: v })} />
      <Row label="carbs" unit="g" step="1"
        value={settings.carbs_g_target} onCommit={(v) => patch({ carbs_g_target: v })} />
      <Row label="fat" unit="g" step="1"
        value={settings.fat_g_target} onCommit={(v) => patch({ fat_g_target: v })} />
      <Row label="weight goal" unit="kg" step="0.1"
        value={settings.weight_goal_kg} onCommit={(v) => patch({ weight_goal_kg: v })} />
    </div>
  );
}
