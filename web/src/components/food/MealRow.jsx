import React, { useState } from 'react';

const TYPE_ICON = {
  breakfast: '🍳',
  lunch: '🥗',
  dinner: '🍽️',
  snack: '🥨',
  drink: '🥤',
  meal: '🍴',
};

function display(n) {
  if (n == null || n === '') return '—';
  return Number.isInteger(n) ? n : Number(n).toFixed(1).replace(/\.0$/, '');
}

// Inline-editable meal row. Tap the row → expands an edit panel
// (textareas + macro inputs) that saves on blur. Lightweight: no
// modal, no formik, just controlled fields tied to per-field commit
// callbacks.
export default function MealRow({ meal, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const icon = TYPE_ICON[meal.meal_type] || TYPE_ICON.meal;
  const macroSummary = [
    meal.protein_g != null && `${display(meal.protein_g)}p`,
    meal.carbs_g != null && `${display(meal.carbs_g)}c`,
    meal.fat_g != null && `${display(meal.fat_g)}f`,
  ].filter(Boolean).join(' / ');

  function commit(field, raw, { numeric = true } = {}) {
    const parsed = raw === '' || raw == null
      ? null
      : numeric ? Number(raw) : raw;
    if (parsed !== null && numeric && Number.isNaN(parsed)) return;
    if (meal[field] === parsed) return;
    onEdit({ [field]: parsed });
  }
  function toggleFlag(field) {
    onEdit({ [field]: meal[field] ? false : true });
  }

  return (
    <div className={`meal-row${expanded ? ' expanded' : ''}`}>
      <button type="button" className="meal-row-main" onClick={() => setExpanded((v) => !v)}>
        <span className="meal-icon" aria-hidden>{icon}</span>
        <div className="meal-body">
          <div className="meal-name">{meal.name}</div>
          <div className="meal-summary muted small">
            {meal.calories != null ? `${display(meal.calories)} kcal` : '— kcal'}
            {macroSummary && <> · {macroSummary}</>}
            {meal.processed ? <> · <span title="processed">⚠️</span></> : null}
            {meal.added_sugar ? <> · <span title="added sugar">🍬</span></> : null}
            {meal.organic ? <> · <span title="organic">🌿</span></> : null}
          </div>
        </div>
        <span className="meal-row-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="meal-edit">
          <div className="meal-edit-row">
            <label className="meal-edit-field">
              <span className="muted small">name</span>
              <input
                key={`name-${meal.id}-${meal.name}`}
                type="text"
                defaultValue={meal.name}
                onBlur={(e) => commit('name', e.target.value, { numeric: false })}
              />
            </label>
            <label className="meal-edit-field">
              <span className="muted small">type</span>
              <select
                value={meal.meal_type}
                onChange={(e) => onEdit({ meal_type: e.target.value })}
              >
                {Object.keys(TYPE_ICON).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="meal-edit-row">
            {[
              ['calories', 'kcal'],
              ['protein_g', 'p (g)'],
              ['carbs_g', 'c (g)'],
              ['fat_g', 'f (g)'],
            ].map(([field, lbl]) => (
              <label key={field} className="meal-edit-field small">
                <span className="muted small">{lbl}</span>
                <input
                  key={`${field}-${meal.id}-${meal[field] ?? ''}`}
                  type="number"
                  inputMode="decimal"
                  step={field === 'calories' ? '1' : '0.1'}
                  defaultValue={meal[field] ?? ''}
                  onBlur={(e) => commit(field, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="meal-edit-row meal-edit-flags">
            <label className="meal-flag">
              <input
                type="checkbox"
                checked={!!meal.processed}
                onChange={() => toggleFlag('processed')}
              />
              processed
            </label>
            <label className="meal-flag">
              <input
                type="checkbox"
                checked={!!meal.added_sugar}
                onChange={() => toggleFlag('added_sugar')}
              />
              added sugar
            </label>
            <label className="meal-flag">
              <input
                type="checkbox"
                checked={!!meal.organic}
                onChange={() => toggleFlag('organic')}
              />
              organic
            </label>
            <button
              type="button"
              className="danger meal-delete"
              onClick={() => {
                if (window.confirm(`delete "${meal.name}"?`)) onDelete();
              }}
            >delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
