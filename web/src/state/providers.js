import { create } from 'zustand';
import { apiGet, apiPut, apiDelete } from '../api.js';

export const useProvidersStore = create((set, get) => ({
  data: null,
  loading: false,
  saving: false,
  error: null,

  async fetchProviders() {
    set({ loading: true, error: null });
    try {
      const data = await apiGet('/providers');
      set({ data, loading: false });
      return data;
    } catch (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  },

  async saveCredential(profileId, credential) {
    set({ saving: true, error: null });
    try {
      const result = await apiPut(`/providers/${encodeURIComponent(profileId)}/credential`, { credential });
      await get().fetchProviders();
      return result;
    } catch (error) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ saving: false });
    }
  },

  async deleteCredential(profileId) {
    set({ saving: true, error: null });
    try {
      const result = await apiDelete(`/providers/${encodeURIComponent(profileId)}/credential`);
      await get().fetchProviders();
      return result;
    } catch (error) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ saving: false });
    }
  },

  async selectMode(mode, profileId) {
    set({ saving: true, error: null });
    try {
      const body = mode === 'provider' ? { mode, profile_id: profileId } : { mode };
      const result = await apiPut('/providers/selection', body);
      await get().fetchProviders();
      return result;
    } catch (error) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ saving: false });
    }
  },
}));
