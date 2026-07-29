import React, { useRef, useState } from 'react';

const TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'meal'];

// Inline meal composer in the Trello pattern: click the button → an
// expanded card-shaped form with name + macros + flags. Save = log,
// reset the form, keep it open. Cancel / blur-empty closes it.
export default function MealComposer({ defaultDate, onLog }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mealType, setMealType] = useState('meal');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [processed, setProcessed] = useState(false);
  const [addedSugar, setAddedSugar] = useState(false);
  const [organic, setOrganic] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  function reset() {
    setName(''); setCalories(''); setProtein(''); setCarbs(''); setFat('');
    setProcessed(false); setAddedSugar(false); setOrganic(false);
  }
  function close() { setOpen(false); reset(); }

  async function save({ keepOpen }) {
    const trimmed = name.trim();
    if (!trimmed) { close(); return; }
    setSaving(true);
    try {
      const fields = { name: trimmed, meal_type: mealType, date: defaultDate };
      const num = (s) => s === '' ? undefined : Number(s);
      if (calories !== '') fields.calories = Math.round(num(calories));
      if (protein !== '') fields.protein_g = num(protein);
      if (carbs !== '') fields.carbs_g = num(carbs);
      if (fat !== '') fields.fat_g = num(fat);
      if (processed) fields.processed = true;
      if (addedSugar) fields.added_sugar = true;
      if (organic) fields.organic = true;
      await onLog(fields);
      reset();
      if (!keepOpen) setOpen(false);
      else setTimeout(() => nameRef.current?.focus(), 0);
    } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button type="button" className="meal-composer-trigger" onClick={() => setOpen(true)}>
        + log a meal
      </button>
    );
  }

  return (
    <div className="meal-composer">
      <div className="meal-composer-row">
        <input
          ref={nameRef}
          autoFocus
          type="text"
          placeholder="e.g. two eggs and toast"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save({ keepOpen: true }); }
            if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
          style={{ flex: 1 }}
        />
        <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="meal-composer-row">
        <input type="number" inputMode="decimal" placeholder="kcal" value={calories}
          onChange={(e) => setCalories(e.target.value)} style={{ width: 84 }} />
        <input type="number" inputMode="decimal" placeholder="p (g)" value={protein}
          onChange={(e) => setProtein(e.target.value)} style={{ width: 72 }} />
        <input type="number" inputMode="decimal" placeholder="c (g)" value={carbs}
          onChange={(e) => setCarbs(e.target.value)} style={{ width: 72 }} />
        <input type="number" inputMode="decimal" placeholder="f (g)" value={fat}
          onChange={(e) => setFat(e.target.value)} style={{ width: 72 }} />
      </div>
      <div className="meal-composer-row meal-composer-flags">
        <label className="meal-flag">
          <input type="checkbox" checked={processed} onChange={(e) => setProcessed(e.target.checked)} />
          processed
        </label>
        <label className="meal-flag">
          <input type="checkbox" checked={addedSugar} onChange={(e) => setAddedSugar(e.target.checked)} />
          added sugar
        </label>
        <label className="meal-flag">
          <input type="checkbox" checked={organic} onChange={(e) => setOrganic(e.target.checked)} />
          organic
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={close}>Cancel</button>
        <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()}
          disabled={saving || !name.trim()}
          onClick={() => save({ keepOpen: true })}
        >{saving ? 'saving…' : 'Add meal'}</button>
      </div>
      <div className="muted small">
        leave macros blank if you'll let Claude estimate later · Enter saves
      </div>
    </div>
  );
}
