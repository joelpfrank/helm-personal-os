import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

// Custom modules = user/AI-built mini-apps (a field schema + items).
// Mirrors state/habits.js: list + per-module item cache, refetch after writes.
export const useModulesStore = create((set, get) => ({
  modules: [],
  itemsByModule: {},   // moduleId -> items[]

  async fetchModules() {
    const modules = await apiGet('/modules');
    set({ modules });
    return modules;
  },

  templates: null, // { groups, templates } — cached catalog

  async createModule(fields) {
    const created = await apiPost('/modules', fields);
    await get().fetchModules();
    return created;
  },

  async fetchTemplates() {
    if (get().templates) return get().templates;
    const data = await apiGet('/module-templates');
    set({ templates: data });
    return data;
  },

  async createFromTemplate(templateKey, label) {
    const body = { template_key: templateKey };
    if (label) body.label = label;
    const created = await apiPost('/modules/from-template', body);
    await get().fetchModules();
    return created;
  },

  async updateModule(id, patch) {
    const updated = await apiPatch(`/modules/${id}`, patch);
    await get().fetchModules();
    return updated;
  },

  archivedModules: [],

  async fetchArchivedModules() {
    const all = await apiGet('/modules?include=archived');
    const archivedModules = all.filter((m) => m.archived_at);
    set({ archivedModules });
    return archivedModules;
  },

  // Hide, don't delete — the module and all its items are kept and can
  // be restored from the Archived area.
  async archiveModule(id) {
    await apiPatch(`/modules/${id}`, { archived: true });
    await get().fetchModules();
    await get().fetchArchivedModules().catch(() => {});
  },

  async restoreModule(id) {
    await apiPatch(`/modules/${id}`, { archived: false });
    await get().fetchModules();
    await get().fetchArchivedModules().catch(() => {});
  },

  async deleteModule(id) {
    await apiDelete(`/modules/${id}`);
    await get().fetchModules();
  },

  async fetchItems(moduleId) {
    const items = await apiGet(`/modules/${moduleId}/items`);
    set((s) => ({ itemsByModule: { ...s.itemsByModule, [moduleId]: items } }));
    return items;
  },

  async addItem(moduleId, data) {
    const created = await apiPost(`/modules/${moduleId}/items`, { data });
    await get().fetchItems(moduleId);
    return created;
  },

  async updateItem(moduleId, itemId, data) {
    const updated = await apiPatch(`/modules/item/${itemId}`, { data });
    await get().fetchItems(moduleId);
    return updated;
  },

  async deleteItem(moduleId, itemId) {
    await apiDelete(`/modules/item/${itemId}`);
    await get().fetchItems(moduleId);
  },
}));
