import React, { useEffect, useState } from 'react';
import { useHabitsStore } from '../state/habits.js';
import HabitRow from '../components/habits/HabitRow.jsx';
import HabitForm from '../components/habits/HabitForm.jsx';
import HabitStats from '../components/habits/HabitStats.jsx';
import HabitsCalendar from '../components/habits/HabitsCalendar.jsx';
import { groupHabits, usedCategories, GROUP_MODES } from '../lib/habitGroups.js';

const GROUP_KEY = 'helm_habits_group'; // persisted grouping preference: 'none' | 'time' | 'category'

function loadGroupMode() {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return GROUP_MODES.includes(v) ? v : 'none';
  } catch { return 'none'; }
}

export default function HabitsView() {
  const todayList = useHabitsStore((s) => s.todayList);
  const habits = useHabitsStore((s) => s.habits);
  const loading = useHabitsStore((s) => s.loading);
  const error = useHabitsStore((s) => s.error);
  const fetchToday = useHabitsStore((s) => s.fetchToday);
  const fetchHabits = useHabitsStore((s) => s.fetchHabits);
  const createHabit = useHabitsStore((s) => s.createHabit);
  const editHabit = useHabitsStore((s) => s.editHabit);
  const deleteHabit = useHabitsStore((s) => s.deleteHabit);
  const logHabit = useHabitsStore((s) => s.logHabit);
  const unlogHabit = useHabitsStore((s) => s.unlogHabit);
  const setOutcome = useHabitsStore((s) => s.setOutcome);

  const [mode, setMode] = useState('today'); // 'today' | 'all' | 'calendar'
  const [groupMode, setGroupMode] = useState(loadGroupMode);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [statsId, setStatsId] = useState(null);

  useEffect(() => {
    fetchToday().catch(() => {});
    fetchHabits().catch(() => {});
  }, [fetchToday, fetchHabits]);

  const editing = editingId
    ? habits.find((h) => h.id === editingId) || todayList?.habits.find((h) => h.id === editingId)
    : null;
  const stats = statsId
    ? todayList?.habits.find((h) => h.id === statsId) || habits.find((h) => h.id === statsId)
    : null;

  const list = mode === 'today' ? (todayList?.habits || []) : habits;
  const groups = groupHabits(list, groupMode);
  const categorySuggestions = usedCategories(habits);

  function changeGroupMode(next) {
    setGroupMode(next);
    try { localStorage.setItem(GROUP_KEY, next); } catch {}
  }

  const allCount = habits.length;
  const todayDone = (todayList?.habits || []).filter((h) => h.completed).length;
  const todayTotal = todayList?.habits.length || 0;

  return (
    <div className="habits-view">
      <div className="habits-toolbar">
        <div className="habits-tabs">
          <button
            type="button"
            className={mode === 'today' ? 'on' : ''}
            onClick={() => setMode('today')}
          >Today {todayTotal > 0 && <span className="muted">({todayDone}/{todayTotal})</span>}</button>
          <button
            type="button"
            className={mode === 'all' ? 'on' : ''}
            onClick={() => setMode('all')}
          >All habits <span className="muted">({allCount})</span></button>
          <button
            type="button"
            className={mode === 'calendar' ? 'on' : ''}
            onClick={() => setMode('calendar')}
          >Calendar</button>
        </div>
        <span style={{ flex: 1 }} />
        {mode !== 'calendar' && (
          <select
            className="habits-group-select"
            aria-label="Group habits by"
            title="group habits by"
            value={groupMode}
            onChange={(e) => changeGroupMode(e.target.value)}
          >
            <option value="none">No grouping</option>
            <option value="time">By time of day</option>
            <option value="category">By category</option>
          </select>
        )}
        <button type="button" onClick={() => setCreateOpen(true)}>+ habit</button>
        {loading && <span className="muted">…</span>}
        {error && <span className="err">{error}</span>}
      </div>

      {mode === 'calendar' ? (
        <div className="habits-cal-host">
          <HabitsCalendar onHabitClick={(id) => setStatsId(id)} />
        </div>
      ) : (
      <div className="habits-list">
        {mode === 'today' && todayList && (
          <div className="muted small habits-datehint">
            {todayList.date} · {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][todayList.day_of_week - 1]}
          </div>
        )}

        {list.length === 0 ? (
          <p className="muted center-pad">
            {mode === 'today'
              ? 'Nothing scheduled today — tap + habit to add one.'
              : 'No habits yet — tap + habit to add your first.'}
          </p>
        ) : groups.map((g) => (
          <React.Fragment key={g.key}>
            {g.label != null && <div className="muted small habits-group-label">{g.label}</div>}
            {g.habits.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                onIncrement={() => logHabit(h.id).catch(() => {})}
                onDecrement={() => unlogHabit(h.id).catch(() => {})}
                onSetOutcome={(status) => setOutcome(h.id, status).catch(() => {})}
                onOpen={() => setStatsId(h.id)}
                onEdit={() => setEditingId(h.id)}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      )}

      {createOpen && (
        <HabitForm
          categories={categorySuggestions}
          onClose={() => setCreateOpen(false)}
          onSave={(fields) => createHabit(fields)}
          onDelete={async () => {}}
        />
      )}
      {editing && (
        <HabitForm
          initial={editing}
          categories={categorySuggestions}
          onClose={() => setEditingId(null)}
          onSave={(fields) => editHabit(editing.id, fields)}
          onDelete={() => deleteHabit(editing.id)}
        />
      )}
      {stats && !editingId && (
        <HabitStats
          habit={stats}
          onEdit={() => { setStatsId(null); setEditingId(stats.id); }}
          onClose={() => setStatsId(null)}
        />
      )}
    </div>
  );
}
