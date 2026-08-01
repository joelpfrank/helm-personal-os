import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

// External MCP servers the coach connects out to. Secrets are masked on read.
export const useMcpServersStore = create((set, get) => ({
  servers: [],
  status: null, // { backend, sdk }
  self: null,   // Helm-as-MCP-server connection details

  async fetchServers() {
    const servers = await apiGet('/mcp-servers');
    set({ servers });
    return servers;
  },

  async fetchStatus() {
    try { const status = await apiGet('/mcp-servers/status'); set({ status }); return status; }
    catch { return null; }
  },

  async fetchSelf() {
    try { const self = await apiGet('/mcp-servers/self'); set({ self }); return self; }
    catch { return null; }
  },

  async createServer(fields) {
    const created = await apiPost('/mcp-servers', fields);
    await get().fetchServers();
    return created;
  },

  async updateServer(id, patch) {
    const updated = await apiPatch(`/mcp-servers/${id}`, patch);
    await get().fetchServers();
    return updated;
  },

  async deleteServer(id) {
    await apiDelete(`/mcp-servers/${id}`);
    await get().fetchServers();
  },
}));
