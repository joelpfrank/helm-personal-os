import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

export const useCustomizeStore = create((set, get) => ({
  memories: [],
  personality: '',
  defaultModel: null,
  loading: false,
  error: null,
  loadedAt: 0,

  async fetchAll() {
    set({ loading: true });
    try {
      const [memories, settings] = await Promise.all([
        apiGet('/memories'),
        apiGet('/chat/settings'),
      ]);
      set({
        memories,
        personality: settings?.personality || '',
        defaultModel: settings?.default_model || null,
        loading: false,
        error: null,
        loadedAt: Date.now(),
      });
    } catch (err) {
      set({ loading: false, error: err.message });
    }
  },

  async setPersonality(text) {
    const before = get().personality;
    set({ personality: text });
    try {
      await apiPatch('/chat/settings', { personality: text });
    } catch (err) {
      set({ personality: before, error: err.message });
      throw err;
    }
  },

  async setDefaultModel(model) {
    const before = get().defaultModel;
    set({ defaultModel: model });
    try {
      await apiPatch('/chat/settings', { default_model: model });
    } catch (err) {
      set({ defaultModel: before, error: err.message });
      throw err;
    }
  },

  async addMemory(text) {
    const m = await apiPost('/memories', { text });
    set((s) => ({ memories: [...s.memories, m] }));
    return m;
  },

  async updateMemory(id, text) {
    const before = get().memories;
    set((s) => ({ memories: s.memories.map((m) => m.id === id ? { ...m, text } : m) }));
    try {
      await apiPatch(`/memories/${id}`, { text });
    } catch (err) {
      set({ memories: before, error: err.message });
      throw err;
    }
  },

  async deleteMemory(id) {
    const before = get().memories;
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
    try {
      await apiDelete(`/memories/${id}`);
    } catch (err) {
      set({ memories: before, error: err.message });
      throw err;
    }
  },
}));
