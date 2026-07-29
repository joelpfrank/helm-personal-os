import React, { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../api.js';

const KIND_COLOR = {
  morning: '#7ad988',
  midday: '#ffc94d',
  evening: '#6aa3ff',
  weekly: '#f5b945',
  biweekly_vision: '#ff6a8d',
};
const KIND_LABEL = {
  morning: 'command meeting',
  midday: 'recalibration',
  evening: 'closeout',
  weekly: 'weekly review',
  biweekly_vision: 'vision review',
};

function pad(n) { return String(n).padStart(2, '0'); }

export default function CheckInHistory() {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    setLoading(true);
    apiGet('/coach/checkins').then((rows) => { setChecks(rows); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const visible = filter === 'all' ? checks : checks.filter((c) => c.kind === filter);

  return (
    <div className="checkin-history">
      <div className="checkin-toolbar">
        <h3>Check-ins</h3>
        <span style={{ flex: 1 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">all</option>
          <option value="morning">command meeting</option>
          <option value="midday">recalibration</option>
          <option value="evening">closeout</option>
          <option value="weekly">weekly</option>
          <option value="biweekly_vision">vision</option>
        </select>
      </div>

      {loading && <p className="muted">loading…</p>}
      {!loading && visible.length === 0 && (
        <p className="muted center-pad">
          No check-ins yet. Open the Chat tab and say <em>"let's run my Daily Command Meeting"</em>.
        </p>
      )}

      <div className="checkin-list">
        {visible.map((c) => (
          <div key={c.id} className="checkin-card" style={{ borderLeftColor: KIND_COLOR[c.kind] || 'var(--accent)' }}>
            <div className="checkin-head">
              <strong>{KIND_LABEL[c.kind]}</strong>
              <span className="muted small">{c.date}</span>
            </div>
            {c.coach_summary && (
              <div className="checkin-summary">{c.coach_summary}</div>
            )}
            {c.payload && Object.keys(c.payload).length > 0 && (
              <pre className="checkin-payload">{JSON.stringify(c.payload, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
