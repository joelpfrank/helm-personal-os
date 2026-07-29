import React, { useEffect } from 'react';
import { useWorkoutsStore } from '../../state/workouts.js';
import ProgressionChart from './ProgressionChart.jsx';

function fmtDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ExerciseHistory({ exercise, onClose, onEdit }) {
  const stats = useWorkoutsStore((s) => s.statsByExercise[exercise.id]);
  const fetchExerciseStats = useWorkoutsStore((s) => s.fetchExerciseStats);

  useEffect(() => { fetchExerciseStats(exercise.id).catch(() => {}); }, [exercise.id, fetchExerciseStats]);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLifting = exercise.kind === 'lifting';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal exercise-history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="habit-stats-head">
          <div>
            <div className="habit-stats-name">{exercise.name}</div>
            <div className="muted">{exercise.kind}{exercise.muscle_group ? ` · ${exercise.muscle_group}` : ''}</div>
          </div>
          {onEdit && <button type="button" onClick={onEdit}>edit</button>}
        </div>

        {!stats ? (
          <p className="muted">loading…</p>
        ) : (
          <>
            <div className="habit-stats-numbers">
              {isLifting ? (
                <>
                  <div className="stat">
                    <div className="stat-num">{stats.pr.best_e1rm_kg}<span className="stat-sub"> kg</span></div>
                    <div className="stat-label">e1RM PR</div>
                  </div>
                  <div className="stat">
                    <div className="stat-num">{stats.pr.heaviest_weight_kg}<span className="stat-sub"> kg</span></div>
                    <div className="stat-label">heaviest × {stats.pr.heaviest_reps ?? '—'}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-num">{stats.pr.best_volume_kg}<span className="stat-sub"> kg·rep</span></div>
                    <div className="stat-label">best volume</div>
                  </div>
                  <div className="stat">
                    <div className="stat-num">{stats.sessions.length}</div>
                    <div className="stat-label">sessions (180d)</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="stat">
                    <div className="stat-num">{Math.round((stats.pr.longest_time_s || 0) / 60)}<span className="stat-sub"> min</span></div>
                    <div className="stat-label">longest</div>
                  </div>
                  <div className="stat">
                    <div className="stat-num">{((stats.pr.farthest_distance_m || 0) / 1000).toFixed(2)}<span className="stat-sub"> km</span></div>
                    <div className="stat-label">farthest</div>
                  </div>
                  <div className="stat">
                    <div className="stat-num">{stats.pr.best_pace_s_per_km ? `${Math.floor(stats.pr.best_pace_s_per_km/60)}:${String(Math.round(stats.pr.best_pace_s_per_km%60)).padStart(2,'0')}` : '—'}</div>
                    <div className="stat-label">best pace /km</div>
                  </div>
                  <div className="stat">
                    <div className="stat-num">{stats.sessions.length}</div>
                    <div className="stat-label">sessions (180d)</div>
                  </div>
                </>
              )}
            </div>

            {isLifting && stats.suggestion && (
              <div className="suggestion-box">
                <div className="suggestion-label">Next session</div>
                <div className="suggestion-headline">
                  <strong>{stats.suggestion.next_weight_kg} kg × {stats.suggestion.next_reps}</strong>
                </div>
                <div className="suggestion-reason muted">{stats.suggestion.reason}</div>
              </div>
            )}

            {isLifting && (
              <div className="chart-host">
                <ProgressionChart sessions={stats.sessions} color={null} />
              </div>
            )}

            <div className="history-sessions">
              <h4 className="modal-heading" style={{ marginTop: 8 }}>Recent sessions</h4>
              {stats.sessions.length === 0 ? (
                <p className="muted">no sessions in the range.</p>
              ) : stats.sessions.slice(0, 12).map((s, i) => (
                <div key={i} className="history-session">
                  <span className="muted">{fmtDate(s.date)}</span>
                  {isLifting ? (
                    <span> {s.top_weight} × {s.top_reps} <span className="muted">vol {s.total_volume}</span></span>
                  ) : (
                    <span> {Math.round(s.total_time_s / 60)}min / {(s.total_distance_m / 1000).toFixed(2)}km</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}
