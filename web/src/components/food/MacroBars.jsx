import React from 'react';
import { progressbarRange } from '../../lib/progressbarRange.js';

function Bar({ label, value, target, unit, color }) {
  const v = Math.max(0, Number(value) || 0);
  const t = Number(target) || 0;
  const pct = t > 0 ? Math.min(100, (v / t) * 100) : 0;
  const display = (n) => Number.isFinite(n) ? Math.round(n) : 0;
  const range = progressbarRange(v, target);
  const macroProgress = range || {};
  return (
    <div
      className="macro-bar"
      role={range ? 'progressbar' : 'status'}
      aria-label={label}
      aria-valuetext={range ? `${display(v)}${unit} of ${display(t)}${unit}` : undefined}
      {...macroProgress}
    >
      <div className="macro-bar-head">
        <span className="macro-bar-label">{label}</span>
        <span className="macro-bar-value">
          <strong>{display(v)}{unit}</strong>
          {t > 0 && <span className="muted"> / {display(t)}{unit}</span>}
        </span>
      </div>
      <div className="macro-bar-track">
        <div
          className="macro-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function MacroBars({ totals, settings }) {
  const t = totals || {};
  const s = settings || {};
  return (
    <div className="macro-bars">
      <Bar
        label="Calories"
        value={t.calories}
        target={s.calorie_target}
        unit=" kcal"
        color="var(--accent)"
      />
      <Bar
        label="Protein"
        value={t.protein_g}
        target={s.protein_g_target}
        unit="g"
        color="#ff6a8d"
      />
      <Bar
        label="Carbs"
        value={t.carbs_g}
        target={s.carbs_g_target}
        unit="g"
        color="#f5b945"
      />
      <Bar
        label="Fat"
        value={t.fat_g}
        target={s.fat_g_target}
        unit="g"
        color="#7ad988"
      />
    </div>
  );
}
