import { create } from 'zustand';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../api.js';
import { normalizeOutcome } from '../lib/habitOutcome.js';

export const useHabitsStore = create((set, get) => ({
  habits: [],          // active habits
  todayList: null,     // { date, day_of_week, habits: [...] }
  loading: false,
  error: null,
  stats: {},           // habit_id → stats payload

  async fetchHabits() {
    try {
      const habits = await apiGet('/habits');
      set({ habits, error: null });
      return habits;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async fetchToday() {
    set({ loading: true });
    try {
      const todayList = await apiGet('/habits/today');
      set({ todayList, loading: false, error: null });
      return todayList;
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  calendar: null,

  async fetchCalendar(from, to) {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const cal = await apiGet(`/habits/calendar${qs ? '?' + qs : ''}`);
      set({ calendar: cal });
      return cal;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async fetchStats(habitId) {
    try {
      const stats = await apiGet(`/habits/${habitId}/stats`);
      set((s) => ({ stats: { ...s.stats, [habitId]: stats } }));
      return stats;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async createHabit(fields) {
    const created = await apiPost('/habits', fields);
    await get().fetchHabits();
    await get().fetchToday();
    return created;
  },

  async editHabit(id, patch) {
    const updated = await apiPatch(`/habits/${id}`, patch);
    await get().fetchHabits();
    await get().fetchToday();
    if (get().stats[id]) await get().fetchStats(id);
    return updated;
  },

  async deleteHabit(id) {
    await apiDelete(`/habits/${id}`);
    set((s) => {
      const stats = { ...s.stats };
      delete stats[id];
      return { stats };
    });
    await get().fetchHabits();
    await get().fetchToday();
  },

  async logHabit(id, { quantity, date, note } = {}) {
    const body = {};
    if (quantity != null) body.quantity = quantity;
    if (date) body.date = date;
    if (note != null) body.note = note;
    await apiPost(`/habits/${id}/log`, body);
    await get().fetchToday();
    if (get().stats[id]) await get().fetchStats(id);
    if (get().calendar) {
      const c = get().calendar;
      await get().fetchCalendar(c.from, c.to);
    }
  },

  // Set the explicit tri-state outcome for a habit/day. 'success' or 'failed'
  // are PUT; 'unspecified' clears the explicit mark (DELETE) so the day falls
  // back to its quantity-derived status. Refreshes today/stats/calendar.
  async setOutcome(id, status, { date } = {}) {
    const s = normalizeOutcome(status);
    try {
      if (s === 'unspecified') {
        const qs = date ? `?date=${encodeURIComponent(date)}` : '';
        await apiDelete(`/habits/${id}/outcome${qs}`);
      } else {
        const body = { status: s };
        if (date) body.date = date;
        await apiPut(`/habits/${id}/outcome`, body);
      }
    } catch (err) { set({ error: err.message }); throw err; }
    await get().fetchToday();
    if (get().stats[id]) await get().fetchStats(id);
    if (get().calendar) {
      const c = get().calendar;
      await get().fetchCalendar(c.from, c.to);
    }
  },

  async unlogHabit(id, { date } = {}) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const qs = params.toString();
    try {
      await apiDelete(`/habits/${id}/log/last${qs ? '?' + qs : ''}`);
    } catch (err) {
      // 404 means "nothing to undo" — silently ignore so a stray tap doesn't error.
      if (err.status !== 404) {
        set({ error: err.message });
        throw err;
      }
    }
    await get().fetchToday();
    if (get().stats[id]) await get().fetchStats(id);
    if (get().calendar) {
      const c = get().calendar;
      await get().fetchCalendar(c.from, c.to);
    }
  },
}));
