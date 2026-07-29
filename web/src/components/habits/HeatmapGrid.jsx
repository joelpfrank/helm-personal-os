import React, { useMemo } from 'react';

// GitHub-style heatmap. `cells` is the API's heatmap[] (oldest first),
// each with { date, scheduled, quantity, ratio, met }. We render 7 rows
// (Mon..Sun) × N weeks; cells start at the Monday of the first week.

function isoDow(s) {
  const d = new Date(s + 'T00:00:00');
  const dow = d.getDay();
  return dow === 0 ? 7 : dow;
}

export default function HeatmapGrid({ cells, color }) {
  const grid = useMemo(() => {
    if (!cells?.length) return [];
    const first = cells[0];
    const padBefore = isoDow(first.date) - 1; // 0..6
    const padded = [...Array(padBefore).fill(null), ...cells];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }
    return weeks;
  }, [cells]);

  const stripe = color || 'var(--accent)';

  return (
    <div className="heatmap">
      {grid.map((week, wi) => (
        <div className="heatmap-col" key={wi}>
          {week.map((c, di) => {
            if (!c) return <div key={di} className="heatmap-cell empty" />;
            const cls = ['heatmap-cell'];
            if (!c.scheduled) cls.push('off');
            else if (c.met) cls.push('met');
            else if (c.ratio > 0) cls.push('partial');
            else cls.push('miss');
            const style = c.scheduled && c.ratio > 0
              ? { background: stripe, opacity: 0.25 + 0.75 * Math.min(1, c.ratio) }
              : undefined;
            return (
              <div
                key={di}
                className={cls.join(' ')}
                style={style}
                title={`${c.date} — ${c.scheduled ? (c.met ? 'done' : `${c.quantity} (${Math.round(c.ratio*100)}%)`) : 'not scheduled'}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
