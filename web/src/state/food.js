import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const useFoodStore = create((set, get) => ({
  today: null,           // full day picture (record + meals + totals + score)
  dayCache: {},          // date -> full day picture
  days: [],              // range of per-day summaries (for history grid)
  settings: null,        // targets
  loading: false,
  error: null,

  async fetchToday() {
    set({ loading: true });
    try {
      const today = await apiGet('/food/today');
      set({ today, loading: false, error: null });
      return today;
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  async fetchDay(date) {
    const day = await apiGet(`/food/days/${encodeURIComponent(date)}`);
    set((s) => ({ dayCache: { ...s.dayCache, [date]: day } }));
    if (date === todayISO()) set({ today: day });
    return day;
  },

  async fetchRange(from, to) {
    set({ loading: true });
    try {
      const qs = new URLSearchParams({ from, to });
      const days = await apiGet(`/food/days?${qs.toString()}`);
      set({ days, loading: false, error: null });
      return days;
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  async fetchSettings() {
    const settings = await apiGet('/food/settings');
    set({ settings });
    return settings;
  },

  async saveSettings(patch) {
    const before = get().settings;
    set({ settings: { ...before, ...patch } });
    try {
      const next = await apiPatch('/food/settings', patch);
      set({ settings: next });
      // Score depends on targets — refresh today so the chip updates.
      await get().fetchToday().catch(() => {});
      return next;
    } catch (err) {
      set({ settings: before, error: err.message });
      throw err;
    }
  },

  async logMeal(fields) {
    const meal = await apiPost('/food/meals', fields);
    // Refresh today (or the affected day) so totals + score recompute.
    if (!fields.date || fields.date === todayISO()) {
      await get().fetchToday().catch(() => {});
    } else {
      await get().fetchDay(fields.date).catch(() => {});
    }
    return meal;
  },

  async editMeal(id, patch) {
    const updated = await apiPatch(`/food/meals/${id}`, patch);
    // Refresh both old and new date if the date changed.
    const dates = new Set([updated.date]);
    const today = get().today;
    if (today) for (const m of today.meals) if (m.id === id) dates.add(m.date);
    for (const d of dates) {
      if (d === todayISO()) await get().fetchToday().catch(() => {});
      else await get().fetchDay(d).catch(() => {});
    }
    return updated;
  },

  async deleteMeal(id) {
    // Find which date(s) this meal lives in for refresh.
    const today = get().today;
    const inToday = today?.meals?.some((m) => m.id === id);
    await apiDelete(`/food/meals/${id}`);
    if (inToday) await get().fetchToday().catch(() => {});
  },

  async patchDay(date, patch) {
    const day = await apiPatch(`/food/days/${encodeURIComponent(date)}`, patch);
    set((s) => ({ dayCache: { ...s.dayCache, [date]: day } }));
    if (date === todayISO()) set({ today: day });
    return day;
  },
}));
