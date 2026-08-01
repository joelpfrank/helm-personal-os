import { create } from 'zustand';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';
import { colorForName } from '../lib/color.js';

function midpoint(prev, next) {
  if (!prev && !next) return 1000;
  if (!prev) return next.position - 1000;
  if (!next) return prev.position + 1000;
  return (prev.position + next.position) / 2;
}

function applyCardMove(board, cardId, toColumnId, newPosition) {
  if (!board) return board;
  let moved = null;
  const without = board.columns.map((col) => ({
    ...col,
    cards: col.cards.filter((c) => {
      if (c.id === cardId) { moved = c; return false; }
      return true;
    }),
  }));
  if (!moved) return board;
  const cols = without.map((col) => {
    if (col.id !== toColumnId) return col;
    const next = { ...moved, column_id: toColumnId, position: newPosition };
    const cards = [...col.cards, next].sort((a, b) => a.position - b.position);
    return { ...col, cards };
  });
  return { ...board, columns: cols };
}

function applyColumnMove(board, columnId, newPosition) {
  if (!board) return board;
  const cols = board.columns
    .map((col) => col.id === columnId ? { ...col, position: newPosition } : col)
    .sort((a, b) => a.position - b.position);
  return { ...board, columns: cols };
}

export const useStore = create((set, get) => ({
  boards: [],
  activeBoardId: null,
  activeBoard: null,
  tags: [],
  loading: false,
  error: null,

  async fetchBoards() {
    try {
      const boards = await apiGet('/boards');
      set({ boards, error: null });
      return boards;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async fetchBoard(id) {
    set({ loading: true });
    try {
      const board = await apiGet(`/boards/${id}`);
      set({ activeBoard: board, activeBoardId: id, loading: false, error: null });
      return board;
    } catch (err) { set({ loading: false, error: err.message }); throw err; }
  },

  async fetchTags() {
    try {
      const tags = await apiGet('/tags');
      set({ tags });
      return tags;
    } catch (err) { set({ error: err.message }); throw err; }
  },

  setActiveBoardId(id) { set({ activeBoardId: id }); },

  // ---------- mutations ----------

  async moveCard(cardId, toColumnId, newPosition) {
    const before = get().activeBoard;
    set((s) => ({ activeBoard: applyCardMove(s.activeBoard, cardId, toColumnId, newPosition) }));
    try {
      await apiPatch(`/cards/${cardId}`, { column_id: toColumnId, position: newPosition });
    } catch (err) {
      set({ activeBoard: before, error: err.message });
    }
  },

  async moveColumn(columnId, newPosition) {
    const before = get().activeBoard;
    set((s) => ({ activeBoard: applyColumnMove(s.activeBoard, columnId, newPosition) }));
    try {
      await apiPatch(`/columns/${columnId}`, { position: newPosition });
    } catch (err) {
      set({ activeBoard: before, error: err.message });
    }
  },

  async updateCard(cardId, patch) {
    try {
      await apiPatch(`/cards/${cardId}`, patch);
      const id = get().activeBoardId;
      if (id) await get().fetchBoard(id);
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async deleteCard(cardId) {
    const before = get().activeBoard;
    set((s) => ({
      activeBoard: s.activeBoard ? {
        ...s.activeBoard,
        columns: s.activeBoard.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) => c.id !== cardId),
        })),
      } : s.activeBoard,
    }));
    try {
      await apiDelete(`/cards/${cardId}`);
    } catch (err) {
      set({ activeBoard: before, error: err.message });
    }
  },

  async createCard(columnId, fields) {
    try {
      await apiPost(`/columns/${columnId}/cards`, fields);
      const id = get().activeBoardId;
      if (id) await get().fetchBoard(id);
    } catch (err) { set({ error: err.message }); throw err; }
  },

  async createBoard(name, { defaultColumns = ['To Do', 'Doing', 'Done'] } = {}) {
    const board = await apiPost('/boards', { name });
    for (const col of defaultColumns) {
      await apiPost(`/boards/${board.id}/columns`, { name: col });
    }
    await get().fetchBoards();
    await get().fetchBoard(board.id);
    return board;
  },

  async renameBoard(id, name) {
    await apiPatch(`/boards/${id}`, { name });
    await get().fetchBoards();
    if (get().activeBoardId === id) {
      set((s) => s.activeBoard ? { activeBoard: { ...s.activeBoard, name } } : {});
    }
  },

  async deleteBoard(id) {
    await apiDelete(`/boards/${id}`);
    await get().fetchBoards();
    const boards = get().boards;
    if (get().activeBoardId === id) {
      if (boards.length) await get().fetchBoard(boards[0].id);
      else set({ activeBoard: null, activeBoardId: null });
    }
  },

  async createColumn(boardId, name) {
    await apiPost(`/boards/${boardId}/columns`, { name });
    if (get().activeBoardId === boardId) await get().fetchBoard(boardId);
  },

  async renameColumn(columnId, name) {
    await apiPatch(`/columns/${columnId}`, { name });
    const id = get().activeBoardId;
    if (id) await get().fetchBoard(id);
  },

  async deleteColumn(columnId) {
    await apiDelete(`/columns/${columnId}`);
    const id = get().activeBoardId;
    if (id) await get().fetchBoard(id);
  },

  async clearColumn(columnId) {
    await apiDelete(`/columns/${columnId}/cards`);
    const id = get().activeBoardId;
    if (id) await get().fetchBoard(id);
  },

  async createTag(name, color) {
    try {
      const tag = await apiPost('/tags', color ? { name, color } : { name });
      set((s) => ({ tags: [...s.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) }));
      return tag;
    } catch (err) {
      // If it already exists, fetch tags and resolve from there.
      if (err.code === 'conflict') {
        const tags = await apiGet('/tags');
        set({ tags });
        const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
      }
      throw err;
    }
  },

  // Find or create a tag by name. Used by inline tag input. If no color is
  // provided we derive one from a hash of the name so each new tag lands on
  // a visible preset rather than the muddy gray server default.
  async findOrCreateTag(name, color) {
    const existing = get().tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    return get().createTag(name, color || colorForName(name));
  },

  midpoint,
}));
