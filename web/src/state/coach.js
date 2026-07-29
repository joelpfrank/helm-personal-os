import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

export const useCoachStore = create((set, get) => ({
  briefing: null,
  vision: null,
  goals: [],
  settings: null,
  recentChecks: [],
  loading: false,
  error: null,

  async fetchBriefing() {
    try {
      const briefing = await apiGet('/coach/briefing');
      set({ briefing, vision: briefing.vision, settings: briefing.coach_settings, recentChecks: briefing.recent_check_ins });
      return briefing;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async fetchAll() {
    set({ loading: true });
    try {
      const [briefing, goals] = await Promise.all([
        apiGet('/coach/briefing'),
        apiGet('/coach/goals'),
      ]);
      set({
        briefing,
        vision: briefing.vision,
        settings: briefing.coach_settings,
        recentChecks: briefing.recent_check_ins,
        goals,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: err.message });
    }
  },

  async fetchGoals() {
    const goals = await apiGet('/coach/goals');
    set({ goals });
    return goals;
  },

  async saveVision(patch) {
    const before = get().vision;
    set({ vision: { ...before, ...patch } });
    try {
      const next = await apiPatch('/coach/vision', patch);
      set({ vision: { ...get().vision, ...next } });
      return next;
    } catch (err) {
      set({ vision: before, error: err.message });
      throw err;
    }
  },

  async markVisionReviewed() {
    const next = await apiPost('/coach/vision/mark_reviewed', {});
    set({ vision: { ...get().vision, ...next } });
    await get().fetchBriefing().catch(() => {});
  },

  async addGoal(fields) {
    const g = await apiPost('/coach/goals', fields);
    await get().fetchGoals();
    await get().fetchBriefing().catch(() => {});
    return g;
  },

  async updateGoal(id, patch) {
    const updated = await apiPatch(`/coach/goals/${id}`, patch);
    await get().fetchGoals();
    await get().fetchBriefing().catch(() => {});
    return updated;
  },

  async completeGoal(id) {
    await apiPost(`/coach/goals/${id}/complete`, {});
    await get().fetchGoals();
    await get().fetchBriefing().catch(() => {});
  },

  async deleteGoal(id) {
    await apiDelete(`/coach/goals/${id}`);
    await get().fetchGoals();
    await get().fetchBriefing().catch(() => {});
  },

  async addObstacle(goalId, obstacle, ifThen) {
    await apiPost(`/coach/goals/${goalId}/obstacles`, { obstacle, if_then: ifThen });
    await get().fetchGoals();
  },

  async deleteObstacle(id) {
    await apiDelete(`/coach/obstacles/${id}`);
    await get().fetchGoals();
  },

  async logCheckIn(kind, payload, coachSummary) {
    const row = await apiPost('/coach/checkins', { kind, payload, coach_summary: coachSummary || '' });
    await get().fetchBriefing().catch(() => {});
    return row;
  },

  async saveSettings(patch) {
    const before = get().settings;
    set({ settings: { ...before, ...patch } });
    try {
      const next = await apiPatch('/coach/settings', patch);
      set({ settings: next });
      await get().fetchBriefing().catch(() => {});
    } catch (err) {
      set({ settings: before, error: err.message });
    }
  },
}));
