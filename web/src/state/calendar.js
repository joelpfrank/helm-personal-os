import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

export const useCalendarStore = create((set, get) => ({
  status: null,         // { configured, authorized, email, calendar_id, last_sync_at, last_sync_error }
  events: [],           // current range
  rangeFrom: null,
  rangeTo: null,
  loading: false,
  error: null,

  async fetchStatus() {
    try {
      const status = await apiGet('/calendar/status');
      set({ status, error: null });
      return status;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async fetchEvents({ from, to } = {}) {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const events = await apiGet(`/calendar/events${qs ? '?' + qs : ''}`);
      set({ events, rangeFrom: from || null, rangeTo: to || null, loading: false, error: null });
      return events;
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  async createEvent(fields) {
    const ev = await apiPost('/calendar/events', fields);
    set((s) => ({ events: [...s.events, ev].sort((a, b) => a.start_at.localeCompare(b.start_at)) }));
    return ev;
  },

  async updateEvent(id, patch) {
    const updated = await apiPatch(`/calendar/events/${id}`, patch);
    set((s) => ({
      events: s.events
        .map((e) => e.id === id ? updated : e)
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    }));
    return updated;
  },

  async deleteEvent(id) {
    await apiDelete(`/calendar/events/${id}`);
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
  },

  async syncNow() {
    set({ loading: true });
    try {
      const r = await apiPost('/calendar/sync', {});
      await get().fetchStatus();
      const { rangeFrom, rangeTo } = get();
      if (rangeFrom && rangeTo) await get().fetchEvents({ from: rangeFrom, to: rangeTo });
      set({ loading: false });
      return r;
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  async disconnect() {
    await apiPost('/calendar/disconnect', {});
    set({ status: null, events: [] });
    await get().fetchStatus();
  },
}));
