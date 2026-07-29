import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, requireString, optionalString, optionalNumber, optionalInt,
  optionalIntArray, optionalColor, optionalDate, rejectUnknownKeys,
} from '../lib/validate.js';
import { getCardWithTags, attachTagsToCards } from '../lib/repo.js';

const sql = {
  byColumn: db.prepare('SELECT id, position FROM cards WHERE column_id = ? ORDER BY position, id'),
  columnExists: db.prepare('SELECT 1 AS x FROM columns WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO cards (column_id, title, notes, due_date, color, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM cards WHERE id = ?'),
  clearTags: db.prepare('DELETE FROM card_tags WHERE card_id = ?'),
  attachTag: db.prepare('INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?, ?)'),
  tagExists: db.prepare('SELECT 1 AS x FROM tags WHERE id = ?'),
};

const replaceTags = db.transaction((cardId, tagIds) => {
  sql.clearTags.run(cardId);
  for (const tagId of tagIds) {
    if (!sql.tagExists.get(tagId)) throw errors.validation(`tag id ${tagId} not found`);
    sql.attachTag.run(cardId, tagId);
  }
});

// Mounted at /api/columns/:columnId/cards
export const columnCardsRouter = Router({ mergeParams: true });

columnCardsRouter.post('/', (req, res, next) => {
  try {
    const columnId = intParam(req.params.columnId, 'columnId');
    if (!sql.columnExists.get(columnId)) throw errors.notFound('column not found');
    rejectUnknownKeys(req.body, ['title', 'notes', 'due_date', 'color', 'position', 'tag_ids']);
    const title = requireString(req.body, 'title');
    const notes = optionalString(req.body, 'notes');
    const dueDate = optionalDate(req.body, 'due_date');
    const color = optionalColor(req.body, 'color');
    const positionRaw = optionalNumber(req.body, 'position');
    const tagIds = optionalIntArray(req.body, 'tag_ids');
    const position = positionRaw == null ? appendPosition(sql.byColumn.all(columnId)) : positionRaw;

    const info = sql.insert.run(
      columnId,
      title,
      notes ?? '',
      dueDate ?? null,
      color ?? null,
      position,
    );
    if (tagIds && tagIds.length) replaceTags(info.lastInsertRowid, tagIds);
    res.status(201).json(getCardWithTags(info.lastInsertRowid));
  } catch (e) { next(e); }
});

// Mounted at /api/cards
export const cardsRouter = Router();

// GET /api/cards?tag=&q=&due_before=&due_after=&board_id=&column_id=
cardsRouter.get('/', (req, res, next) => {
  try {
    const { tag, q, due_before, due_after, board_id, column_id } = req.query;

    const where = [];
    const vals = [];
    let join = '';

    if (tag) {
      join += ' JOIN card_tags ct ON ct.card_id = c.id JOIN tags t ON t.id = ct.tag_id';
      where.push('LOWER(t.name) = LOWER(?)');
      vals.push(String(tag));
    }
    if (q) {
      where.push('(c.title LIKE ? OR c.notes LIKE ?)');
      const pat = `%${String(q)}%`;
      vals.push(pat, pat);
    }
    if (due_before) {
      where.push('c.due_date IS NOT NULL AND c.due_date < ?');
      vals.push(String(due_before));
    }
    if (due_after) {
      where.push('c.due_date IS NOT NULL AND c.due_date > ?');
      vals.push(String(due_after));
    }
    if (column_id) {
      where.push('c.column_id = ?');
      vals.push(intParam(column_id, 'column_id'));
    }
    if (board_id) {
      join += ' JOIN columns col ON col.id = c.column_id';
      where.push('col.board_id = ?');
      vals.push(intParam(board_id, 'board_id'));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const querySql = `
      SELECT DISTINCT c.id, c.column_id, c.title, c.notes, c.due_date, c.color,
                      c.position, c.created_at, c.updated_at
      FROM cards c${join}
      ${whereSql}
      ORDER BY c.column_id, c.position, c.id
    `;
    const rows = db.prepare(querySql).all(...vals);
    res.json(attachTagsToCards(rows));
  } catch (e) { next(e); }
});

cardsRouter.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const card = getCardWithTags(id);
    if (!card) throw errors.notFound('card not found');
    res.json(card);
  } catch (e) { next(e); }
});

cardsRouter.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['title', 'notes', 'due_date', 'color', 'position', 'column_id', 'tag_ids']);

    const updates = [];
    const vals = [];

    const titleRaw = optionalString(req.body, 'title');
    if (titleRaw !== undefined) {
      if (!titleRaw || !titleRaw.trim()) throw errors.validation('title must be non-empty');
      updates.push('title = ?'); vals.push(titleRaw.trim());
    }
    const notesRaw = optionalString(req.body, 'notes');
    if (notesRaw !== undefined) {
      updates.push('notes = ?'); vals.push(notesRaw ?? '');
    }
    const dueRaw = optionalDate(req.body, 'due_date');
    if (dueRaw !== undefined) {
      updates.push('due_date = ?'); vals.push(dueRaw);
    }
    const colorRaw = optionalColor(req.body, 'color');
    if (colorRaw !== undefined) {
      updates.push('color = ?'); vals.push(colorRaw);
    }
    const positionRaw = optionalNumber(req.body, 'position');
    if (positionRaw !== undefined) {
      if (positionRaw == null) throw errors.validation('position cannot be null');
      updates.push('position = ?'); vals.push(positionRaw);
    }
    const colIdRaw = optionalInt(req.body, 'column_id');
    if (colIdRaw !== undefined) {
      if (colIdRaw == null) throw errors.validation('column_id cannot be null');
      if (!sql.columnExists.get(colIdRaw)) throw errors.notFound('target column not found');
      updates.push('column_id = ?'); vals.push(colIdRaw);
    }

    const tagIds = optionalIntArray(req.body, 'tag_ids');

    const apply = db.transaction(() => {
      if (updates.length) {
        vals.push(id);
        const info = db.prepare(`UPDATE cards SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
        if (info.changes === 0) throw errors.notFound('card not found');
      } else {
        const exists = db.prepare('SELECT 1 AS x FROM cards WHERE id = ?').get(id);
        if (!exists) throw errors.notFound('card not found');
      }
      if (tagIds !== undefined) replaceTags(id, tagIds || []);
    });
    apply();

    res.json(getCardWithTags(id));
  } catch (e) { next(e); }
});

cardsRouter.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('card not found');
    res.status(204).end();
  } catch (e) { next(e); }
});
