import React, { useEffect, useMemo, useState } from 'react';
import { useCalendarStore } from '../state/calendar.js';
import { getHashParam, writeHashParams, onHashChange } from '../lib/hash.js';
import EventCard from '../components/calendar/EventCard.jsx';
import EventForm from '../components/calendar/EventForm.jsx';
import MonthGrid, { DayDetailModal } from '../components/calendar/MonthGrid.jsx';

const TABS = ['today', 'week', 'month', 'settings'];
function readTab() {
  const t = getHashParam('cal');
  return TABS.includes(t) ? t : 'today';
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function startOfWeek(d) {
  // ISO week starting Monday.
  const x = startOfDay(d);
  const dow = x.getDay() || 7;
  x.setDate(x.getDate() - (dow - 1));
  return x;
}
function fmtDayHeader(d) {
  const today = startOfDay(new Date()).getTime();
  const t = startOfDay(d).getTime();
  const diff = Math.round((t - today) / 86400_000);
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (diff === 0) return `${label} · today`;
  if (diff === 1) return `${label} · tomorrow`;
  if (diff === -1) return `${label} · yesterday`;
  return label;
}

export default function CalendarView() {
  const status = useCalendarStore((s) => s.status);
  const events = useCalendarStore((s) => s.events);
  const loading = useCalendarStore((s) => s.loading);
  const error = useCalendarStore((s) => s.error);
  const fetchStatus = useCalendarStore((s) => s.fetchStatus);
  const fetchEvents = useCalendarStore((s) => s.fetchEvents);
  const createEvent = useCalendarStore((s) => s.createEvent);
  const updateEvent = useCalendarStore((s) => s.updateEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const syncNow = useCalendarStore((s) => s.syncNow);

  const [tab, setTab] = useState(readTab);
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));
  const [openEvent, setOpenEvent] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openDay, setOpenDay] = useState(null);

  useEffect(() => {
    fetchStatus().catch(() => {});
    return onHashChange(() => setTab(readTab()));
  }, [fetchStatus]);

  // Fetch the range relevant to the active tab.
  useEffect(() => {
    if (!status?.authorized) return;
    let from, to;
    if (tab === 'today') {
      from = startOfDay(new Date()).toISOString();
      to = endOfDay(new Date()).toISOString();
    } else if (tab === 'week') {
      from = weekAnchor.toISOString();
      const weekEnd = new Date(weekAnchor); weekEnd.setDate(weekEnd.getDate() + 7);
      to = weekEnd.toISOString();
    } else {
      return;
    }
    fetchEvents({ from, to }).catch(() => {});
  }, [tab, status?.authorized, weekAnchor, fetchEvents]);

  function switchTab(id) {
    writeHashParams({ cal: id });
    setTab(id);
  }

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [events],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const e of sorted) {
      const k = e.start_at.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return map;
  }, [sorted]);

  const weekDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekAnchor);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [weekAnchor]);

  function todayKey() { return startOfDay(new Date()).toISOString().slice(0, 10); }

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'on' : ''}
              onClick={() => switchTab(t)}
            >{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {status?.authorized && tab === 'week' && (
          <div className="week-nav">
            <button type="button" onClick={() => setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>‹</button>
            <button type="button" onClick={() => setWeekAnchor(startOfWeek(new Date()))}>this week</button>
            <button type="button" onClick={() => setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>›</button>
          </div>
        )}
        {status?.authorized && (
          <>
            <button type="button" onClick={() => setCreating(true)}>+ event</button>
            <button type="button" onClick={() => syncNow().catch(() => {})}>sync</button>
          </>
        )}
        {loading && <span className="muted small">…</span>}
        {error && <span className="err small">{error}</span>}
      </div>

      <div className="calendar-body">
        {!status ? (
          <p className="muted center-pad">loading…</p>
        ) : !status.authorized ? (
          <NotConnected status={status} />
        ) : tab === 'today' ? (
          <TodayList events={eventsByDay.get(todayKey()) || []} onClick={setOpenEvent} />
        ) : tab === 'week' ? (
          <WeekGrid days={weekDays} eventsByDay={eventsByDay} onClick={setOpenEvent} />
        ) : tab === 'month' ? (
          <MonthGrid onPickEvent={setOpenEvent} onPickDay={setOpenDay} />
        ) : (
          <Settings status={status} />
        )}
      </div>

      {creating && (
        <EventForm
          onClose={() => setCreating(false)}
          onSave={(fields) => createEvent(fields)}
        />
      )}
      {openEvent && (
        <EventForm
          initial={openEvent}
          onClose={() => setOpenEvent(null)}
          onSave={(fields) => updateEvent(openEvent.id, fields)}
          onDelete={() => deleteEvent(openEvent.id)}
        />
      )}
      {openDay && (
        <DayDetailModal
          iso={openDay}
          onClose={() => setOpenDay(null)}
          onPickEvent={setOpenEvent}
        />
      )}
    </div>
  );
}

function TodayList({ events, onClick }) {
  if (events.length === 0) {
    return <p className="muted center-pad">nothing on the calendar today.</p>;
  }
  return (
    <div className="cal-today-list">
      {events.map((e) => <EventCard key={e.id} event={e} onClick={onClick} />)}
    </div>
  );
}

function WeekGrid({ days, eventsByDay, onClick }) {
  return (
    <div className="cal-week-grid">
      {days.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const dayEvents = eventsByDay.get(key) || [];
        const isToday = key === startOfDay(new Date()).toISOString().slice(0, 10);
        return (
          <div key={key} className={`cal-week-day${isToday ? ' today' : ''}`}>
            <div className="cal-week-day-head">{fmtDayHeader(d)}</div>
            <div className="cal-week-day-events">
              {dayEvents.length === 0
                ? <div className="muted small cal-day-empty">—</div>
                : dayEvents.map((e) => <EventCard key={e.id} event={e} onClick={onClick} />)
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NotConnected({ status }) {
  return (
    <div className="center-pad cal-disconnected">
      <p className="muted">Calendar not connected.</p>
      <p className="muted small">
        {status?.configured
          ? 'Open /api/calendar/auth/start from the device running Helm, or through a secure tunnel you configured, to authorize Google Calendar.'
          : 'OAuth credentials not configured. Place .google-credentials.json at the project root.'}
      </p>
    </div>
  );
}

function Settings({ status }) {
  const syncNow = useCalendarStore((s) => s.syncNow);
  const disconnect = useCalendarStore((s) => s.disconnect);
  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Calendar? Your local events mirror will be cleared. You can re-authorize anytime from the device running Helm or through a secure tunnel you configured.')) return;
    await disconnect();
  }
  return (
    <div className="cal-settings">
      <div className="cal-settings-row">
        <span className="muted">connected as</span>
        <span>{status.email || '—'}</span>
      </div>
      <div className="cal-settings-row">
        <span className="muted">calendar id</span>
        <span className="mono">{status.calendar_id || '—'}</span>
      </div>
      <div className="cal-settings-row">
        <span className="muted">last sync</span>
        <span>{status.last_sync_at ? new Date(status.last_sync_at).toLocaleString() : 'never'}</span>
      </div>
      <div className="cal-settings-row">
        <span className="muted">window</span>
        <span className="small muted">
          {status.sync_from ? new Date(status.sync_from).toLocaleDateString() : '?'}
          {' → '}
          {status.sync_to ? new Date(status.sync_to).toLocaleDateString() : '?'}
        </span>
      </div>
      {status.last_sync_error && (
        <div className="cal-settings-row">
          <span className="muted">last error</span>
          <span className="err small">{status.last_sync_error}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => syncNow().catch(() => {})}>sync now</button>
        <button type="button" className="danger" onClick={handleDisconnect}>disconnect</button>
      </div>
    </div>
  );
}
