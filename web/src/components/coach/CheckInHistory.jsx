import React, { useEffect, useState } from 'react';
import { apiGet } from '../../api.js';


const KIND_LABEL = {
  morning: 'command meeting',
  midday: 'recalibration',
  evening: 'closeout',
  weekly: 'weekly review',
  biweekly_vision: 'vision review',
};


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
      <header className="checkins-intro">
        <div className="today-kicker">Reflection into evidence</div>
        <h3>Check-ins</h3>
        <p>Coach summaries are interpretation. Expand a check-in to inspect the structured record stored in Helm.</p>
      </header>
      <div className="checkin-toolbar">
        <label className="muted small" htmlFor="checkin-filter">Show</label>
        <span style={{ flex: 1 }} />
        <select id="checkin-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
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
          <details key={c.id} className="checkin-card">
            <summary className="checkin-head">
              <span><strong>{KIND_LABEL[c.kind]}</strong><span className="muted small">Model summary</span></span>
              <time className="muted small">{c.date}</time>
            </summary>
            {c.coach_summary && (
              <div className="checkin-summary">{c.coach_summary}</div>
            )}
            {c.payload && Object.keys(c.payload).length > 0 && (
              <div className="checkin-record">
                <div className="today-kicker">Stored record</div>
                <pre className="checkin-payload">{JSON.stringify(c.payload, null, 2)}</pre>
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
