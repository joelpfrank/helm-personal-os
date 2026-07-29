import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';

// In-flight stream state — kept outside the store so we can cancel
// from anywhere without round-tripping through zustand.
let _abortController = null;

export const useChatStore = create((set, get) => ({
  conversations: [],
  activeId: null,
  // messages: full Anthropic-style array (text + tool_use + tool_result blocks)
  messages: [],
  // pendingAssistant: live-building assistant message during streaming
  pendingAssistant: null, // { text: '', toolCalls: [{ id, name, input?, result?, error? }] }
  streaming: false,
  status: null, // { configured, model, tool_count }
  loading: false,
  error: null,

  async fetchStatus() {
    try {
      const status = await apiGet('/chat/status');
      set({ status });
      return status;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async fetchConversations() {
    try {
      const conversations = await apiGet('/chat/conversations');
      set({ conversations });
      return conversations;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async openConversation(id) {
    set({ loading: true });
    try {
      const conv = await apiGet(`/chat/conversations/${id}`);
      set({ activeId: id, messages: conv.messages || [], loading: false, error: null });
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  async newConversation(opts = {}) {
    const conv = await apiPost('/chat/conversations', opts);
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id, messages: [], pendingAssistant: null }));
    return conv;
  },

  async deleteConversation(id) {
    await apiDelete(`/chat/conversations/${id}`);
    set((s) => {
      const next = s.conversations.filter((c) => c.id !== id);
      const stillActive = s.activeId === id ? null : s.activeId;
      return {
        conversations: next,
        activeId: stillActive,
        messages: stillActive ? s.messages : [],
        pendingAssistant: null,
      };
    });
  },

  cancelStream() {
    if (_abortController) {
      _abortController.abort();
      _abortController = null;
    }
    set({ streaming: false, pendingAssistant: null });
  },

  async setConversationModel(id, model) {
    const updated = await apiPatch(`/chat/conversations/${id}`, { model });
    set((s) => ({
      conversations: s.conversations.map((c) => c.id === id ? { ...c, model: updated.model } : c),
    }));
    return updated;
  },

  // Accepts either a plain string (text-only message) or an array of
  // content blocks (mix of text + image + document). The store + server
  // both normalize to the array form.
  async sendMessage(input) {
    const content = typeof input === 'string'
      ? [{ type: 'text', text: input }]
      : input;
    if (!Array.isArray(content) || content.length === 0) return;
    const hasText = content.some((b) => b.type === 'text' && b.text && b.text.trim());
    const hasAttach = content.some((b) => b.type !== 'text');
    if (!hasText && !hasAttach) return;

    const conversationId = get().activeId;
    if (!conversationId) {
      await get().newConversation();
      return get().sendMessage(content);
    }

    // Optimistically add the user message + start pending assistant.
    const userMsg = { id: -Date.now(), role: 'user', content };
    set((s) => ({
      messages: [...s.messages, userMsg],
      pendingAssistant: { text: '', toolCalls: [] },
      streaming: true,
      error: null,
    }));

    _abortController = new AbortController();
    try {
      // Build the URL with token in dev/standalone via api.js helpers —
      // but for SSE streaming we need fetch direct so we can read the
      // response body progressively. Reuse the same token logic.
      const token = readToken();
      const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
        signal: _abortController.signal,
      });
      if (!res.ok || !res.body) {
        let body = null;
        try { body = await res.json(); } catch {}
        throw new Error(body?.error?.message || `${res.status} ${res.statusText}`);
      }
      await consumeSSE(res.body, (evt) => handleEvent(evt, set, get));
    } catch (err) {
      if (err.name === 'AbortError') {
        set({ streaming: false, pendingAssistant: null });
        return;
      }
      set({ streaming: false, pendingAssistant: null, error: err.message });
    } finally {
      _abortController = null;
      // Refresh conversation list so the (auto)title and updated_at show.
      get().fetchConversations().catch(() => {});
      // Replace optimistic user message with the real one from DB.
      if (get().activeId === conversationId) {
        try {
          const conv = await apiGet(`/chat/conversations/${conversationId}`);
          set({ messages: conv.messages || [], pendingAssistant: null, streaming: false });
        } catch { /* ignore */ }
      }
    }
  },
}));

// ---------- helpers ----------

function readToken() {
  if (typeof window === 'undefined') return null;
  // In dev the vite proxy injects; in prod we use localStorage.
  if (!import.meta.env.DEV) {
    return localStorage.getItem('dashboard_token');
  }
  return null;
}

async function consumeSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try { onEvent(JSON.parse(data)); }
        catch { /* ignore */ }
      }
    }
  }
}

function handleEvent(evt, set, get) {
  switch (evt.type) {
    case 'text_delta':
      set((s) => ({
        pendingAssistant: {
          ...(s.pendingAssistant || { text: '', toolCalls: [] }),
          text: (s.pendingAssistant?.text || '') + (evt.text || ''),
        },
      }));
      break;
    case 'tool_start':
      set((s) => ({
        pendingAssistant: {
          ...(s.pendingAssistant || { text: '', toolCalls: [] }),
          toolCalls: [...(s.pendingAssistant?.toolCalls || []), { id: evt.id, name: evt.name }],
        },
      }));
      break;
    case 'tool_input':
      set((s) => ({
        pendingAssistant: {
          ...s.pendingAssistant,
          toolCalls: (s.pendingAssistant?.toolCalls || []).map(
            (tc) => tc.id === evt.id ? { ...tc, input: evt.input } : tc,
          ),
        },
      }));
      break;
    case 'tool_result':
      set((s) => ({
        pendingAssistant: {
          ...s.pendingAssistant,
          toolCalls: (s.pendingAssistant?.toolCalls || []).map(
            (tc) => tc.id === evt.id ? { ...tc, ok: evt.ok, error: evt.message } : tc,
          ),
        },
      }));
      break;
    case 'error':
      set({ error: evt.message, streaming: false });
      break;
    case 'done':
      set({ streaming: false });
      break;
  }
}
