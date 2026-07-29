import React, { useEffect, useState } from 'react';
import ColorSwatch from '../ColorSwatch.jsx';
import { TIME_ORDER, TIME_LABELS } from '../../lib/habitGroups.js';

const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // ISO 1..7

function parseCsv(s) {
  return String(s || '').split(',').map((x) => Number(x)).filter((n) => n >= 1 && n <= 7);
}

export default function HabitForm({ initial, onClose, onSave, onDelete, categories = [] }) {
  const isEdit = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name || '');
  const [emoji, setEmoji] = useState(initial?.emoji || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [color, setColor] = useState(initial?.color ?? null);
  const [goal, setGoal] = useState(initial?.goal_quantity ?? 1);
  const [unit, setUnit] = useState(initial?.unit || '');
  const [timeOfDay, setTimeOfDay] = useState(initial?.time_of_day || 'anytime');
  const [category, setCategory] = useState(initial?.category || '');
  const [days, setDays] = useState(() =>
    new Set(parseCsv(initial?.days_of_week || '1,2,3,4,5,6,7')),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleDay(d) {
    setDays((s) => {
      const next = new Set(s);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  }

  async function save() {
    if (!name.trim() || !days.size) return;
    setSaving(true);
    try {
      const goalNum = Number(goal);
      const fields = {
        name: name.trim(),
        emoji: emoji.trim(),
        description,
        color,
        goal_quantity: Number.isFinite(goalNum) && goalNum > 0 ? goalNum : 1,
        unit: unit.trim(),
        days_of_week: [...days].sort((a, b) => a - b).join(','),
        time_of_day: timeOfDay,
        category: category.trim(),
      };
      await onSave(fields);
      onClose();
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm(`Delete habit "${name}" and ALL its logs? (Tip: archive keeps history.)`)) return;
    await onDelete();
    onClose();
  }

  async function archive() {
    await onSave({ archived: true });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{isEdit ? 'Edit habit' : 'New habit'}</h3>

        <div className="modal-row">
          <label>name</label>
          <input
            type="text"
            className="habit-emoji-input"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🥤"
            maxLength={4}
            title="optional emoji — use your OS emoji keyboard"
            style={{ width: 52, textAlign: 'center', fontSize: 20 }}
          />
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Meditate, Drink water, Workout"
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-row">
          <label>goal</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            style={{ width: 80 }}
          />
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="unit — optional (min, glass, page…)"
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-row stretch">
          <label>days</label>
          <div className="dow-picker">
            {DOW_LABELS.map((lbl, i) => {
              const day = i + 1;
              const on = days.has(day);
              return (
                <button
                  type="button"
                  key={day}
                  className={`dow-btn${on ? ' on' : ''}`}
                  onClick={() => toggleDay(day)}
                >{lbl}</button>
              );
            })}
            <button
              type="button"
              className="dow-preset"
              onClick={() => setDays(new Set([1,2,3,4,5,6,7]))}
            >daily</button>
            <button
              type="button"
              className="dow-preset"
              onClick={() => setDays(new Set([1,2,3,4,5]))}
            >weekdays</button>
          </div>
        </div>

        <div className="modal-row">
          <label htmlFor="habit-time-of-day">when</label>
          <select
            id="habit-time-of-day"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            title="time of day — used to group habits"
          >
            {TIME_ORDER.map((t) => (
              <option key={t} value={t}>{TIME_LABELS[t]}</option>
            ))}
          </select>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="habit-category-suggestions"
            maxLength={50}
            aria-label="category"
            placeholder="category — optional (Health, Work…)"
            style={{ flex: 1 }}
          />
          <datalist id="habit-category-suggestions">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        <div className="modal-row">
          <label>color</label>
          <ColorSwatch value={color} onChange={setColor} />
        </div>

        <div className="modal-row stretch">
          <label>notes</label>
          <textarea
            className="notes-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="optional context, why this habit, links, etc."
            style={{ flex: 1 }}
          />
        </div>

        <div className="modal-actions">
          {isEdit && (
            <>
              <button type="button" className="danger" onClick={remove}>delete</button>
              <button type="button" onClick={archive}>archive</button>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>cancel</button>
          <button type="button" onClick={save} disabled={saving || !name.trim() || !days.size}>
            {saving ? 'saving…' : (isEdit ? 'save' : 'create')}
          </button>
        </div>
      </div>
    </div>
  );
}
