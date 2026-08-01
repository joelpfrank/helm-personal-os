// Shared helpers for assembling nested reads (boards → columns → cards → tags).

import { db } from '../db.js';

const sql = {
  boardById: db.prepare(`
    SELECT id, name, position, created_at, updated_at
    FROM boards WHERE id = ?
  `),
  columnsByBoard: db.prepare(`
    SELECT id, board_id, name, position, created_at, updated_at
    FROM columns WHERE board_id = ?
    ORDER BY position, id
  `),
  cardsByBoard: db.prepare(`
    SELECT c.id, c.column_id, c.title, c.notes, c.due_date, c.color,
           c.position, c.created_at, c.updated_at
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    WHERE col.board_id = ?
    ORDER BY c.column_id, c.position, c.id
  `),
  tagsForBoard: db.prepare(`
    SELECT ct.card_id, t.id, t.name, t.color
    FROM card_tags ct
    JOIN tags t ON t.id = ct.tag_id
    JOIN cards c ON c.id = ct.card_id
    JOIN columns col ON col.id = c.column_id
    WHERE col.board_id = ?
  `),
  cardById: db.prepare(`
    SELECT id, column_id, title, notes, due_date, color,
           position, created_at, updated_at
    FROM cards WHERE id = ?
  `),
  tagsForCard: db.prepare(`
    SELECT t.id, t.name, t.color
    FROM card_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE ct.card_id = ?
    ORDER BY t.name
  `),
  tagsForCards: db.prepare(`
    SELECT ct.card_id, t.id, t.name, t.color
    FROM card_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE ct.card_id IN (SELECT value FROM json_each(?))
  `),
};

export function getBoardNested(id) {
  const board = sql.boardById.get(id);
  if (!board) return null;

  const columns = sql.columnsByBoard.all(id);
  const cards = sql.cardsByBoard.all(id);
  const tagRows = sql.tagsForBoard.all(id);

  const tagsByCard = new Map();
  for (const r of tagRows) {
    const list = tagsByCard.get(r.card_id) || [];
    list.push({ id: r.id, name: r.name, color: r.color });
    tagsByCard.set(r.card_id, list);
  }

  const cardsByColumn = new Map();
  for (const c of cards) {
    c.tags = tagsByCard.get(c.id) || [];
    const list = cardsByColumn.get(c.column_id) || [];
    list.push(c);
    cardsByColumn.set(c.column_id, list);
  }

  for (const col of columns) {
    col.cards = cardsByColumn.get(col.id) || [];
  }

  return { ...board, columns };
}

export function getCardWithTags(id) {
  const card = sql.cardById.get(id);
  if (!card) return null;
  card.tags = sql.tagsForCard.all(id);
  return card;
}

export function attachTagsToCards(cards) {
  if (!cards.length) return cards;
  const ids = cards.map((c) => c.id);
  const rows = sql.tagsForCards.all(JSON.stringify(ids));
  const byCard = new Map();
  for (const r of rows) {
    const list = byCard.get(r.card_id) || [];
    list.push({ id: r.id, name: r.name, color: r.color });
    byCard.set(r.card_id, list);
  }
  for (const c of cards) c.tags = byCard.get(c.id) || [];
  return cards;
}
