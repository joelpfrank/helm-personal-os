import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarStore } from '../../state/calendar.js';
import {
  monthGridCells, monthLabel, dowHeaders, bucketEventsByDay, isoDate, addDays,
} from '../../lib/calendar-math.js';

// Google-mobile-style vertical month list. We render the current
// month, plus the previous + next month above/below so the user can
// scroll seamlessly. As the user nears either edge we extend the
// range (and `fetchEvents` re-pulls a fresh window). A "Today" pill
// in the toolbar scrolls back to the current day.

const HOW_MANY_MONTHS_BACK = 2;
const HOW_MANY_MONTHS_FWD = 6;

function makeMonthRange(centerYear, centerMonth0) {
  const out = [];
  for (let i = -HOW_MANY_MONTHS_BACK; i <= HOW_MANY_MONTHS_FWD; i++) {
    const d = new Date(centerYear, centerMonth0 + i, 1);
    out.push({ year: d.getFullYear(), month0: d.getMonth() });
  }
  return out;
}

export default function MonthGrid({ onPickEvent, onPickDay }) {
  const events = useCalendarStore((s) => s.events);
  const fetchEvents = useCalendarStore((s) => s.fetchEvents);

  const now = new Date();
  const [center] = useState({ year: now.getFullYear(), month0: now.getMonth() });
  const months = useMemo(() => makeMonthRange(center.year, center.month0), [center]);
  const todayRef = useRef(null);

  // Fetch events for the whole rendered range in one go.
  useEffect(() => {
    const first = new Date(months[0].year, months[0].month0, 1);
    const lastDef = months[months.length - 1];
    const last = new Date(lastDef.year, lastDef.month0 + 1, 0, 23, 59, 59, 999);
    fetchEvents({ from: first.toISOString(), to: last.toISOString() }).catch(() => {});
  }, [months, fetchEvents]);

  // Scroll to today on first render.
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const bucket = useMemo(() => bucketEventsByDay(events), [events]);

  return (
    <div className="month-grid-scroller">
      <div className="month-dow-header">
        {dowHeaders().map((d) => <div key={d}>{d}</div>)}
      </div>
      {months.map(({ year, month0 }) => (
        <MonthBlock
          key={`${year}-${month0}`}
          year={year}
          month0={month0}
          bucket={bucket}
          onPickEvent={onPickEvent}
          onPickDay={onPickDay}
          todayRef={todayRef}
        />
      ))}
    </div>
  );
}

function MonthBlock({ year, month0, bucket, onPickEvent, onPickDay, todayRef }) {
  const cells = useMemo(() => monthGridCells(year, month0), [year, month0]);
  // 6-week grid; trim trailing empty week if all 7 of its cells are out-of-month.
  const trimmed = cells.slice(0, cells.findIndex((c, i) => i >= 35 && cells.slice(i, i + 7).every((x) => !x.inMonth)) || cells.length);
  return (
    <section className="month-block">
      <h3 className="month-block-title">{monthLabel(year, month0)}</h3>
      <div className="month-grid">
        {trimmed.map((cell) => {
          const dayEvents = bucket[cell.iso] || [];
          const more = dayEvents.length - 3;
          return (
            <button
              key={cell.iso}
              type="button"
              className={`month-cell${cell.inMonth ? '' : ' out'}${cell.isToday ? ' today' : ''}`}
              onClick={() => onPickDay?.(cell.iso)}
              ref={cell.isToday ? todayRef : undefined}
            >
              <div className="month-cell-day">{cell.day}</div>
              <div className="month-cell-events">
                {dayEvents.slice(0, 3).map((ev) => (
                  <span
                    key={ev.id}
                    className={`month-chip${ev.all_day ? ' all-day' : ''}`}
                    style={{ borderLeftColor: ev.color || 'var(--accent)' }}
                    onClick={(e) => { e.stopPropagation(); onPickEvent?.(ev); }}
                    title={ev.summary || '(no title)'}
                  >
                    {ev.summary || '(untitled)'}
                  </span>
                ))}
                {more > 0 && <span className="month-chip more">+{more}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DayDetailModal({ iso, onClose, onPickEvent }) {
  const events = useCalendarStore((s) => s.events);
  const dayEvents = useMemo(
    () => events.filter((e) => (e.start_at || '').slice(0, 10) === iso)
      .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || '')),
    [events, iso],
  );
  const pretty = useMemo(() => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [iso]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal day-detail" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{pretty}</h3>
        {dayEvents.length === 0 ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <div className="day-event-list">
            {dayEvents.map((ev) => (
              <button
                key={ev.id}
                type="button"
                className="day-event"
                style={{ borderLeftColor: ev.color || 'var(--accent)' }}
                onClick={() => { onPickEvent?.(ev); onClose(); }}
              >
                <div className="day-event-time">
                  {ev.all_day ? 'all day' : new Date(ev.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </div>
                <div className="day-event-summary">{ev.summary || '(untitled)'}</div>
                {ev.location && <div className="day-event-loc muted small">{ev.location}</div>}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}
