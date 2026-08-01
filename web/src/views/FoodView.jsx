import React, { useEffect, useState } from 'react';
import { useFoodStore } from '../state/food.js';
import { getHashParam, writeHashParams, onHashChange } from '../lib/hash.js';
import DayHeader from '../components/food/DayHeader.jsx';
import MacroBars from '../components/food/MacroBars.jsx';
import MealRow from '../components/food/MealRow.jsx';
import MealComposer from '../components/food/MealComposer.jsx';
import FoodSettings from '../components/food/FoodSettings.jsx';
import FoodHistoryGrid from '../components/food/FoodHistoryGrid.jsx';
import TrackingTabs from '../components/tracking/TrackingTabs.jsx';
import '../styles/tracking.css';

const TABS = ['today', 'history', 'settings'];
function readTab() {
  const t = getHashParam('food');
  return TABS.includes(t) ? t : 'today';
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function FoodView() {
  const today = useFoodStore((s) => s.today);
  const settings = useFoodStore((s) => s.settings);
  const dayCache = useFoodStore((s) => s.dayCache);
  const error = useFoodStore((s) => s.error);
  const fetchToday = useFoodStore((s) => s.fetchToday);
  const fetchDay = useFoodStore((s) => s.fetchDay);
  const fetchSettings = useFoodStore((s) => s.fetchSettings);
  const logMeal = useFoodStore((s) => s.logMeal);
  const editMeal = useFoodStore((s) => s.editMeal);
  const deleteMeal = useFoodStore((s) => s.deleteMeal);
  const patchDay = useFoodStore((s) => s.patchDay);

  const [tab, setTab] = useState(readTab);
  const [openDay, setOpenDay] = useState(null);

  useEffect(() => {
    fetchToday().catch(() => {});
    fetchSettings().catch(() => {});
    return onHashChange(() => setTab(readTab()));
  }, [fetchToday, fetchSettings]);

  function switchTab(id) {
    writeHashParams({ food: id });
    setTab(id);
  }

  const day = today || { date: todayISO(), meals: [], totals: { total_meals: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, flagged: 0 }, score: 0 };

  return (
    <section className="food-view tracking-surface tracking-food" aria-labelledby="food-heading">
      <header className="tracking-page-header">
        <div>
          <div className="tracking-kicker">Today’s food evidence</div>
          <h2 id="food-heading" className="tracking-page-heading">Food</h2>
          <p className="tracking-page-summary">Log what you know. Nutrition values remain estimates, not medical advice.</p>
        </div>
      </header>
      <div className="food-toolbar tracking-toolbar">
        <TrackingTabs
          className="food-tabs"
          label="Food views"
          idPrefix="food"
          selected={tab}
          onSelect={switchTab}
          tabs={TABS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }))}
        />
        <span style={{ flex: 1 }} />
        {error && <span className="err small">{error}</span>}
      </div>

      <div
        className="food-body"
        id={`food-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`food-tab-${tab}`}
      >
        {tab === 'today' && (
          <div className="food-today">
            <DayHeader day={day} onPatch={(p) => patchDay(day.date, p)} />
            <MacroBars totals={day.totals} settings={settings || {}} />
            <h4 className="food-section-heading">Meals</h4>
            {day.meals.length === 0 ? (
              <p className="muted center-pad">
                Nothing logged yet. Log a meal below; calories and macros can stay blank.
              </p>
            ) : (
              <div className="meal-list">
                {day.meals.map((m) => (
                  <MealRow
                    key={m.id}
                    meal={m}
                    onEdit={(patch) => editMeal(m.id, patch).catch(() => {})}
                    onDelete={() => deleteMeal(m.id).catch(() => {})}
                  />
                ))}
              </div>
            )}
            <MealComposer
              defaultDate={day.date}
              onLog={(fields) => logMeal(fields)}
            />
          </div>
        )}
        {tab === 'history' && (
          <FoodHistoryGrid onPickDay={(d) => { fetchDay(d); setOpenDay(d); }} />
        )}
        {tab === 'settings' && <FoodSettings />}
      </div>

      {openDay && (
        <DayDetail
          date={openDay}
          day={dayCache[openDay]}
          settings={settings || {}}
          onClose={() => setOpenDay(null)}
        />
      )}
    </section>
  );
}

function DayDetail({ date, day, settings, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const pretty = new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal day-detail" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-heading">{pretty}</h3>
        {!day ? (
          <p className="muted">loading…</p>
        ) : (
          <>
            <DayHeader day={day} onPatch={() => {}} />
            <MacroBars totals={day.totals} settings={settings} />
            <h4 className="food-section-heading">Meals</h4>
            {day.meals.length === 0
              ? <p className="muted">No meals logged.</p>
              : (
                <div className="meal-list">
                  {day.meals.map((m) => (
                    <div key={m.id} className="meal-row past">
                      <div className="meal-row-main static">
                        <span className="meal-icon" aria-hidden>{({
                          breakfast: '🍳', lunch: '🥗', dinner: '🍽️',
                          snack: '🥨', drink: '🥤', meal: '🍴',
                        })[m.meal_type] || '🍴'}</span>
                        <div className="meal-body">
                          <div className="meal-name">{m.name}</div>
                          <div className="meal-summary muted small">
                            {m.calories != null ? `${m.calories} kcal` : '— kcal'}
                            {m.protein_g != null && ` · ${m.protein_g}p`}
                            {m.carbs_g != null && ` / ${m.carbs_g}c`}
                            {m.fat_g != null && ` / ${m.fat_g}f`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
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
