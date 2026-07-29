import React, { useEffect, useState } from 'react';
import { useHabitsStore } from '../../state/habits.js';

const RANGE_OPTIONS = [
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
];

const DOW_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // ISO

function isoDow(s) {
  const d = new Date(s + 'T00:00:00');
  const dow = d.getDay();
  return dow === 0 ? 7 : dow;
}

function isToday(iso) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return iso === `${y}-${m}-${day}`;
}

function dayLabel(iso) {
  return Number(iso.slice(8, 10));
}

function monthBreak(prev, curr) {
  return !prev || prev.slice(0, 7) !== curr.slice(0, 7);
}

function shortMonth(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' });
}

export default function HabitsCalendar({ onHabitClick }) {
  const calendar = useHabitsStore((s) => s.calendar);
  const fetchCalendar = useHabitsStore((s) => s.fetchCalendar);
  const [days, setDays] = useState(30);

  useEffect(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    const isoFrom = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    fetchCalendar(isoFrom).catch(() => {});
  }, [days, fetchCalendar]);

  if (!calendar) return <p className="muted center-pad">loading…</p>;
  if (calendar.habits.length === 0) {
    return <p className="muted center-pad">no habits yet — create one to see the grid.</p>;
  }

  const dates = calendar.dates;

  return (
    <div className="cal-wrap">
      <div className="cal-controls">
        <div className="muted small">{calendar.from} → {calendar.to}</div>
        <span style={{ flex: 1 }} />
        <div className="cal-range">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.label}
              type="button"
              className={r.days === days ? 'on' : ''}
              onClick={() => setDays(r.days)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div className="cal-scroll">
        <table className="cal-grid">
          <thead>
            <tr>
              <th className="cal-name-col"></th>
              {dates.map((d, i) => {
                const isFirstOfMonth = monthBreak(dates[i - 1], d);
                return (
                  <th key={d} className={`cal-date-head${isToday(d) ? ' today' : ''}`}>
                    <div className="cal-date-dow">{DOW_INITIAL[isoDow(d) - 1]}</div>
                    <div className="cal-date-day">{dayLabel(d)}</div>
                    {isFirstOfMonth && (
                      <div className="cal-date-month">{shortMonth(d)}</div>
                    )}
                  </th>
                );
              })}
              <th className="cal-summary-col">completion</th>
            </tr>
          </thead>
          <tbody>
            {calendar.habits.map((h) => {
              const scheduledCount = h.entries.filter((e) => e.scheduled).length;
              const successCount = h.entries.filter((e) => e.effective_status === 'success').length;
              const failedCount = h.entries.filter((e) => e.effective_status === 'failed').length;
              // resolved = days with an explicit judgement. Blank (unspecified)
              // days are NOT counted as misses, so the rate reflects only days
              // that were actually resolved.
              const resolvedCount = successCount + failedCount;
              const pct = resolvedCount > 0 ? Math.round((successCount / resolvedCount) * 100) : 0;
              const stripe = h.color || 'var(--accent)';
              return (
                <tr key={h.id}>
                  <th
                    className="cal-name"
                    style={{ borderLeftColor: stripe }}
                    onClick={() => onHabitClick?.(h.id)}
                  >
                    <span className="cal-name-text">{h.name}</span>
                  </th>
                  {h.entries.map((e) => {
                    const cls = ['cal-cell'];
                    if (isToday(e.date)) cls.push('today');
                    // Five distinct states: not-scheduled, achieved (met),
                    // explicit not-achieved (failed), partial progress, and
                    // genuinely blank (unspecified) — the last is NOT a miss.
                    let label;
                    if (!e.scheduled) { cls.push('off'); label = 'not scheduled'; }
                    else if (e.effective_status === 'success') { cls.push('met'); label = 'achieved'; }
                    else if (e.effective_status === 'failed') { cls.push('failed'); label = 'not achieved'; }
                    else if (e.ratio > 0) { cls.push('partial'); label = `${e.quantity}/${h.goal_quantity} (${Math.round(e.ratio * 100)}%)`; }
                    else { cls.push('unspecified'); label = 'unspecified'; }
                    // Failed cells get a solid warning tint; partial cells fade
                    // the habit colour by ratio. Unspecified stays empty.
                    const style = e.scheduled && e.effective_status !== 'failed' && e.ratio > 0
                      ? { background: stripe, opacity: 0.25 + 0.75 * Math.min(1, e.ratio) }
                      : undefined;
                    return (
                      <td
                        key={e.date}
                        className={cls.join(' ')}
                        style={style}
                        title={`${h.name} · ${e.date} — ${label}`}
                      />
                    );
                  })}
                  <td className="cal-summary">
                    <div className="cal-summary-num">{pct}%</div>
                    <div className="cal-summary-sub muted">{successCount}/{resolvedCount}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
