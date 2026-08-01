import React, { useEffect } from 'react';
import { useHabitsStore } from '../../state/habits.js';
import HeatmapGrid from './HeatmapGrid.jsx';

export default function HabitStats({ habit, onEdit, onClose }) {
  const stats = useHabitsStore((s) => s.stats[habit.id]);
  const fetchStats = useHabitsStore((s) => s.fetchStats);

  useEffect(() => {
    fetchStats(habit.id).catch(() => {});
  }, [habit.id, fetchStats]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pct = stats ? Math.round(stats.completion_rate * 100) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal habit-stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="habit-stats-head">
          <div>
            <div className="habit-stats-name">{habit.name}</div>
            {habit.description && <div className="muted">{habit.description}</div>}
          </div>
          <button type="button" onClick={onEdit}>edit</button>
        </div>

        {!stats ? (
          <p className="muted">loading stats…</p>
        ) : (
          <>
            <div className="habit-stats-numbers">
              <div className="stat">
                <div className="stat-num">{stats.current_streak}</div>
                <div className="stat-label">current streak</div>
              </div>
              <div className="stat">
                <div className="stat-num">{stats.longest_streak}</div>
                <div className="stat-label">longest (90d)</div>
              </div>
              <div className="stat">
                <div className="stat-num">{pct}%</div>
                <div className="stat-label">completion (90d)</div>
              </div>
              <div className="stat">
                <div className="stat-num">{stats.met_days}<span className="stat-sub">/{stats.scheduled_days}</span></div>
                <div className="stat-label">met / scheduled</div>
              </div>
            </div>

            <div className="habit-stats-heatmap">
              <HeatmapGrid cells={stats.heatmap} color={habit.color} />
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
