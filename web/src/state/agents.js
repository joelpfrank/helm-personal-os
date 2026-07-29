import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

// Agents & automations: saved agent setups (name + instructions + optional
// schedule). The coach is the implicit default and isn't listed here.
export const useAgentsStore = create((set, get) => ({
  agents: [],
  templates: null,

  async fetchAgents() {
    const agents = await apiGet('/agents');
    set({ agents });
    return agents;
  },

  async fetchTemplates() {
    if (get().templates) return get().templates;
    const data = await apiGet('/agents/templates');
    set({ templates: data });
    return data;
  },

  async createFromTemplate(key, label) {
    const body = { template_key: key };
    if (label) body.label = label;
    const created = await apiPost('/agents/from-template', body);
    await get().fetchAgents();
    return created;
  },

  async createAgent(fields) {
    const created = await apiPost('/agents', fields);
    await get().fetchAgents();
    return created;
  },

  async updateAgent(id, patch) {
    const updated = await apiPatch(`/agents/${id}`, patch);
    await get().fetchAgents();
    return updated;
  },

  async deleteAgent(id) {
    await apiDelete(`/agents/${id}`);
    await get().fetchAgents();
  },

  async runNow(id) {
    const result = await apiPost(`/agents/${id}/run`, {});
    await get().fetchAgents();
    return result;
  },
}));
