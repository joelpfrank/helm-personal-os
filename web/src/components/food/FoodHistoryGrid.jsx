import React, { useEffect, useMemo, useState } from 'react';
import { useFoodStore } from '../../state/food.js';
import { monthGridCells, monthLabel, dowHeaders } from '../../lib/calendar-math.js';

function scoreColor(score) {
  if (score >= 70) return '#7ad988';
  if (score >= 40) return '#f5b945';
  if (score > 0)   return '#ff8a73';
  return 'transparent';
}

function pad(n) { return String(n).padStart(2, '0'); }
function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function WeightSparkline({ days }) {
  const points = days
    .map((d) => ({ date: d.date, w: d.weight_kg }))
    .filter((p) => p.w != null);
  if (points.length < 2) {
    return <div className="weight-sparkline muted small">log weight on at least two days to see a trend</div>;
  }
  const ws = points.map((p) => p.w);
  const min = Math.min(...ws);
  const max = Math.max(...ws);
  const range = Math.max(1, max - min);
  const w = 320, h = 56, pad = 6;
  const path = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((p.w - min) / range) * (h - 2 * pad);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="weight-sparkline">
      <div className="muted small">weight: {min.toFixed(1)} → {max.toFixed(1)} kg ({points.length} days)</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function FoodHistoryGrid({ onPickDay }) {
  const days = useFoodStore((s) => s.days);
  const fetchRange = useFoodStore((s) => s.fetchRange);

  const now = new Date();
  const [center, setCenter] = useState({ year: now.getFullYear(), month0: now.getMonth() });
  const months = useMemo(() => [
    { year: center.year, month0: center.month0 - 1 },
    { year: center.year, month0: center.month0 },
  ].map(({ year, month0 }) => {
    const d = new Date(year, month0, 1);
    return { year: d.getFullYear(), month0: d.getMonth() };
  }), [center]);

  useEffect(() => {
    const first = new Date(months[0].year, months[0].month0, 1);
    const lastDef = months[months.length - 1];
    const last = new Date(lastDef.year, lastDef.month0 + 1, 0);
    fetchRange(iso(first), iso(last)).catch(() => {});
  }, [months, fetchRange]);

  const byDate = useMemo(() => {
    const m = new Map();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  function shift(delta) {
    setCenter((c) => {
      const d = new Date(c.year, c.month0 + delta, 1);
      return { year: d.getFullYear(), month0: d.getMonth() };
    });
  }

  return (
    <div className="food-history">
      <div className="food-history-toolbar">
        <button type="button" onClick={() => shift(-1)}>‹</button>
        <button type="button" onClick={() => setCenter({ year: now.getFullYear(), month0: now.getMonth() })}>today</button>
        <button type="button" onClick={() => shift(1)}>›</button>
      </div>
      <WeightSparkline days={days} />
      <div className="month-dow-header">
        {dowHeaders().map((d) => <div key={d}>{d}</div>)}
      </div>
      {months.map(({ year, month0 }) => (
        <MonthBlock key={`${year}-${month0}`} year={year} month0={month0} byDate={byDate} onPickDay={onPickDay} />
      ))}
    </div>
  );
}

function MonthBlock({ year, month0, byDate, onPickDay }) {
  const cells = useMemo(() => monthGridCells(year, month0), [year, month0]);
  return (
    <section className="month-block">
      <h3 className="month-block-title">{monthLabel(year, month0)}</h3>
      <div className="month-grid">
        {cells.map((cell) => {
          const day = byDate.get(cell.iso);
          const score = day?.score ?? 0;
          const totals = day?.totals;
          const cal = totals?.calories || 0;
          return (
            <button
              key={cell.iso}
              type="button"
              className={`month-cell food-cell${cell.inMonth ? '' : ' out'}${cell.isToday ? ' today' : ''}`}
              onClick={() => onPickDay?.(cell.iso)}
              style={{ background: cell.inMonth ? `linear-gradient(180deg, ${scoreColor(score)}22 0%, transparent 70%)` : undefined }}
              title={day ? `${cell.iso} · ${cal} kcal · score ${score}` : cell.iso}
            >
              <div className="month-cell-day">{cell.day}</div>
              {day && totals?.total_meals > 0 && (
                <div className="food-cell-info">
                  <span className="food-cell-cal">{cal}</span>
                  <span className="food-cell-score" style={{ color: scoreColor(score) }}>{score}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
