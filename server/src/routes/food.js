import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import {
  intParam, requireString, optionalString, optionalNumber, optionalInt, rejectUnknownKeys,
} from '../lib/validate.js';
import { todayISO } from '../lib/dates.js';

const router = Router();

const sql = {
  dayByDate: db.prepare(`
    SELECT id, date, weight_kg, steps, active_calories, exercise_minutes,
           notes, created_at, updated_at
    FROM food_days WHERE date = ?
  `),
  daysInRange: db.prepare(`
    SELECT id, date, weight_kg, steps, active_calories, exercise_minutes,
           notes, created_at, updated_at
    FROM food_days WHERE date BETWEEN ? AND ?
    ORDER BY date
  `),
  insertDay: db.prepare(`
    INSERT INTO food_days (date) VALUES (?) ON CONFLICT(date) DO NOTHING
  `),
  // Update only the columns that are explicitly provided (null = "leave as-is"
  // would normally be tricky, but each PATCH builds its own UPDATE).
  upsertDayMinimal: db.prepare(`
    INSERT INTO food_days (date) VALUES (?)
    ON CONFLICT(date) DO NOTHING
  `),

  mealsByDate: db.prepare(`
    SELECT id, date, meal_type, name, calories, protein_g, carbs_g, fat_g,
           fiber_g, sugar_g, processed, organic, added_sugar,
           notes, logged_at, created_at, updated_at
    FROM meals WHERE date = ?
    ORDER BY logged_at, id
  `),
  mealsInRange: db.prepare(`
    SELECT id, date, meal_type, name, calories, protein_g, carbs_g, fat_g,
           fiber_g, sugar_g, processed, organic, added_sugar,
           notes, logged_at, created_at, updated_at
    FROM meals WHERE date BETWEEN ? AND ?
    ORDER BY date, logged_at, id
  `),
  mealById: db.prepare(`
    SELECT id, date, meal_type, name, calories, protein_g, carbs_g, fat_g,
           fiber_g, sugar_g, processed, organic, added_sugar,
           notes, logged_at, created_at, updated_at
    FROM meals WHERE id = ?
  `),
  insertMeal: db.prepare(`
    INSERT INTO meals (date, meal_type, name, calories, protein_g, carbs_g, fat_g,
                       fiber_g, sugar_g, processed, organic, added_sugar, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deleteMeal: db.prepare('DELETE FROM meals WHERE id = ?'),

  // Aggregate macros for a date range. NULL macros are treated as 0 so a
  // partially-filled day still contributes what's known.
  totalsByDate: db.prepare(`
    SELECT date,
           COUNT(*)                                  AS total_meals,
           COALESCE(SUM(calories), 0)                AS calories,
           COALESCE(SUM(protein_g), 0)               AS protein_g,
           COALESCE(SUM(carbs_g), 0)                 AS carbs_g,
           COALESCE(SUM(fat_g), 0)                   AS fat_g,
           COALESCE(SUM(fiber_g), 0)                 AS fiber_g,
           COALESCE(SUM(sugar_g), 0)                 AS sugar_g,
           SUM(CASE WHEN processed = 1 OR added_sugar = 1 THEN 1 ELSE 0 END) AS flagged
    FROM meals WHERE date = ?
  `),
  totalsInRange: db.prepare(`
    SELECT date,
           COUNT(*)                                  AS total_meals,
           COALESCE(SUM(calories), 0)                AS calories,
           COALESCE(SUM(protein_g), 0)               AS protein_g,
           COALESCE(SUM(carbs_g), 0)                 AS carbs_g,
           COALESCE(SUM(fat_g), 0)                   AS fat_g,
           COALESCE(SUM(fiber_g), 0)                 AS fiber_g,
           COALESCE(SUM(sugar_g), 0)                 AS sugar_g,
           SUM(CASE WHEN processed = 1 OR added_sugar = 1 THEN 1 ELSE 0 END) AS flagged
    FROM meals WHERE date BETWEEN ? AND ?
    GROUP BY date
  `),

  settingsGet: db.prepare(`
    SELECT calorie_target, protein_g_target, carbs_g_target, fat_g_target,
           weight_goal_kg, updated_at
    FROM food_settings WHERE id = 1
  `),
};

// Daily health score (0-100). Pure function; never persisted.
// Weights: 10 logged-at-all + 40 calorie target + 25 protein + 25 clean-food.
function computeScore({ totals, settings }) {
  if (!totals || totals.total_meals === 0) return 0;
  let score = 10; // logged at least one meal
  if (settings.calorie_target && totals.calories) {
    const diff = Math.abs(totals.calories - settings.calorie_target);
    score += Math.max(0, 40 * (1 - diff / 500));
  }
  if (settings.protein_g_target && totals.protein_g) {
    const r = totals.protein_g / settings.protein_g_target;
    if (r >= 0.8 && r <= 1.2) score += 25;
    else if (r >= 0.6 && r <= 1.4) score += 12;
  }
  const flagged = totals.flagged || 0;
  const pct = flagged / totals.total_meals;
  score += Math.max(0, 25 * (1 - pct / 0.5));
  return Math.round(Math.min(100, score));
}

function emptyTotals(date) {
  return { date, total_meals: 0, calories: 0, protein_g: 0, carbs_g: 0,
    fat_g: 0, fiber_g: 0, sugar_g: 0, flagged: 0 };
}

function fullDay(date) {
  const day = sql.dayByDate.get(date) || { date, weight_kg: null, steps: null,
    active_calories: null, exercise_minutes: null, notes: '' };
  const meals = sql.mealsByDate.all(date);
  const totals = sql.totalsByDate.get(date) || emptyTotals(date);
  const settings = sql.settingsGet.get() || {};
  return {
    ...day,
    meals,
    totals,
    score: computeScore({ totals, settings }),
  };
}

// ---------- day-level reads ----------

router.get('/today', (_req, res) => {
  res.json(fullDay(todayISO()));
});

router.get('/days', (req, res, next) => {
  try {
    const from = String(req.query.from || todayISO());
    const to   = String(req.query.to   || todayISO());
    const dayRows  = sql.daysInRange.all(from, to);
    const totalRows = sql.totalsInRange.all(from, to);
    const settings = sql.settingsGet.get() || {};
    const byDate = new Map(dayRows.map((d) => [d.date, d]));
    const out = [];
    const seen = new Set();
    for (const t of totalRows) {
      const day = byDate.get(t.date) || { date: t.date, weight_kg: null, steps: null,
        active_calories: null, exercise_minutes: null, notes: '' };
      out.push({ ...day, totals: t, score: computeScore({ totals: t, settings }) });
      seen.add(t.date);
    }
    // Days with weight/activity but no meals still show up.
    for (const d of dayRows) {
      if (seen.has(d.date)) continue;
      const t = emptyTotals(d.date);
      out.push({ ...d, totals: t, score: 0 });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    res.json(out);
  } catch (e) { next(e); }
});

router.get('/days/:date', (req, res, next) => {
  try {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('date must be YYYY-MM-DD');
    res.json(fullDay(date));
  } catch (e) { next(e); }
});

router.patch('/days/:date', (req, res, next) => {
  try {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('date must be YYYY-MM-DD');
    rejectUnknownKeys(req.body, ['weight_kg', 'steps', 'active_calories', 'exercise_minutes', 'notes']);
    sql.upsertDayMinimal.run(date);

    const updates = [];
    const vals = [];
    const weight = optionalNumber(req.body, 'weight_kg');
    if (weight !== undefined) { updates.push('weight_kg = ?'); vals.push(weight); }
    const steps = optionalInt(req.body, 'steps');
    if (steps !== undefined) { updates.push('steps = ?'); vals.push(steps); }
    const ac = optionalInt(req.body, 'active_calories');
    if (ac !== undefined) { updates.push('active_calories = ?'); vals.push(ac); }
    const em = optionalInt(req.body, 'exercise_minutes');
    if (em !== undefined) { updates.push('exercise_minutes = ?'); vals.push(em); }
    const notes = optionalString(req.body, 'notes');
    if (notes !== undefined) { updates.push('notes = ?'); vals.push(notes ?? ''); }

    if (updates.length) {
      vals.push(date);
      db.prepare(`UPDATE food_days SET ${updates.join(', ')} WHERE date = ?`).run(...vals);
    }
    res.json(fullDay(date));
  } catch (e) { next(e); }
});

// ---------- meals ----------

router.get('/meals', (req, res, next) => {
  try {
    if (req.query.date) {
      const date = String(req.query.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('date must be YYYY-MM-DD');
      return res.json(sql.mealsByDate.all(date));
    }
    const from = String(req.query.from || todayISO());
    const to   = String(req.query.to   || todayISO());
    res.json(sql.mealsInRange.all(from, to));
  } catch (e) { next(e); }
});

const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'meal']);

function readMealBody(body, { partial = false } = {}) {
  rejectUnknownKeys(body, [
    'date', 'meal_type', 'name',
    'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
    'processed', 'organic', 'added_sugar', 'notes', 'logged_at',
  ]);
  const out = {};
  if (!partial) {
    out.name = requireString(body, 'name');
  } else {
    const n = optionalString(body, 'name');
    if (n !== undefined) {
      if (!n || !n.trim()) throw errors.validation('name cannot be empty');
      out.name = n.trim();
    }
  }
  const date = optionalString(body, 'date');
  if (date !== undefined) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('date must be YYYY-MM-DD');
    out.date = date || todayISO();
  } else if (!partial) {
    out.date = todayISO();
  }
  const mt = optionalString(body, 'meal_type');
  if (mt !== undefined) {
    if (mt && !MEAL_TYPES.has(mt)) throw errors.validation(`meal_type must be one of ${[...MEAL_TYPES].join(', ')}`);
    out.meal_type = mt || 'meal';
  } else if (!partial) {
    out.meal_type = 'meal';
  }
  for (const k of ['calories']) {
    const v = optionalInt(body, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g']) {
    const v = optionalNumber(body, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ['processed', 'organic', 'added_sugar']) {
    if (k in (body || {})) {
      const v = body[k];
      if (typeof v !== 'boolean' && v !== 0 && v !== 1) {
        throw errors.validation(`${k} must be boolean`);
      }
      out[k] = v ? 1 : 0;
    }
  }
  const notes = optionalString(body, 'notes');
  if (notes !== undefined) out.notes = notes ?? '';
  return out;
}

router.post('/meals', (req, res, next) => {
  try {
    const m = readMealBody(req.body, { partial: false });
    sql.upsertDayMinimal.run(m.date);
    const info = sql.insertMeal.run(
      m.date,
      m.meal_type ?? 'meal',
      m.name,
      m.calories ?? null,
      m.protein_g ?? null,
      m.carbs_g ?? null,
      m.fat_g ?? null,
      m.fiber_g ?? null,
      m.sugar_g ?? null,
      m.processed ?? 0,
      m.organic ?? 0,
      m.added_sugar ?? 0,
      m.notes ?? '',
    );
    res.status(201).json(sql.mealById.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.patch('/meals/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const existing = sql.mealById.get(id);
    if (!existing) throw errors.notFound('meal not found');
    const m = readMealBody(req.body, { partial: true });
    const updates = [];
    const vals = [];
    for (const [k, v] of Object.entries(m)) {
      updates.push(`${k} = ?`);
      vals.push(v);
    }
    if (m.date) sql.upsertDayMinimal.run(m.date);
    if (updates.length) {
      vals.push(id);
      db.prepare(`UPDATE meals SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    }
    res.json(sql.mealById.get(id));
  } catch (e) { next(e); }
});

router.delete('/meals/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.deleteMeal.run(id);
    if (info.changes === 0) throw errors.notFound('meal not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- settings (targets) ----------

router.get('/settings', (_req, res) => {
  res.json(sql.settingsGet.get() || {});
});

router.patch('/settings', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, [
      'calorie_target', 'protein_g_target', 'carbs_g_target', 'fat_g_target', 'weight_goal_kg',
    ]);
    const updates = [];
    const vals = [];
    const cal = optionalInt(req.body, 'calorie_target');
    if (cal !== undefined) { updates.push('calorie_target = ?'); vals.push(cal); }
    for (const k of ['protein_g_target', 'carbs_g_target', 'fat_g_target', 'weight_goal_kg']) {
      const v = optionalNumber(req.body, k);
      if (v !== undefined) { updates.push(`${k} = ?`); vals.push(v); }
    }
    if (updates.length) {
      db.prepare(`UPDATE food_settings SET ${updates.join(', ')} WHERE id = 1`).run(...vals);
    }
    res.json(sql.settingsGet.get());
  } catch (e) { next(e); }
});

export default router;
