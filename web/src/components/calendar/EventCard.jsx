import React from 'react';

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function EventCard({ event, onClick }) {
  const start = fmtTime(event.start_at);
  const end = fmtTime(event.end_at);
  const allDay = !!event.all_day;
  const style = event.color ? { borderLeftColor: event.color } : undefined;
  return (
    <button type="button" className={`event-card${allDay ? ' all-day' : ''}`} onClick={() => onClick?.(event)} style={style}>
      {!allDay && (
        <div className="event-time">{start}{end ? `–${end}` : ''}</div>
      )}
      <div className="event-summary">{event.summary || '(untitled)'}</div>
      {event.location && <div className="event-location muted small">{event.location}</div>}
    </button>
  );
}
