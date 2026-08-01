import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, requireString, optionalString, optionalNumber, optionalInt, rejectUnknownKeys,
} from '../lib/validate.js';

const sql = {
  byBoard: db.prepare('SELECT id, board_id, name, position, created_at, updated_at FROM columns WHERE board_id = ? ORDER BY position, id'),
  get: db.prepare('SELECT id, board_id, name, position, created_at, updated_at FROM columns WHERE id = ?'),
  boardExists: db.prepare('SELECT 1 AS x FROM boards WHERE id = ?'),
  insert: db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)'),
  delete: db.prepare('DELETE FROM columns WHERE id = ?'),
};

// Mounted at /api/boards/:boardId/columns
export const boardColumnsRouter = Router({ mergeParams: true });

boardColumnsRouter.post('/', (req, res, next) => {
  try {
    const boardId = intParam(req.params.boardId, 'boardId');
    if (!sql.boardExists.get(boardId)) throw errors.notFound('board not found');
    rejectUnknownKeys(req.body, ['name', 'position']);
    const name = requireString(req.body, 'name');
    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.byBoard.all(boardId)) : positionRaw;
    const info = sql.insert.run(boardId, name, position);
    res.status(201).json(sql.get.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

// Mounted at /api/columns
export const columnsRouter = Router();

columnsRouter.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['name', 'position', 'board_id']);
    const updates = [];
    const vals = [];
    const nameRaw = optionalString(req.body, 'name');
    if (nameRaw !== undefined) {
      if (!nameRaw || !nameRaw.trim()) throw errors.validation('name must be non-empty');
      updates.push('name = ?'); vals.push(nameRaw.trim());
    }
    const positionRaw = optionalNumber(req.body, 'position');
    if (positionRaw !== undefined) {
      if (positionRaw == null) throw errors.validation('position cannot be null');
      updates.push('position = ?'); vals.push(positionRaw);
    }
    const boardIdRaw = optionalInt(req.body, 'board_id');
    if (boardIdRaw !== undefined) {
      if (boardIdRaw == null) throw errors.validation('board_id cannot be null');
      if (!sql.boardExists.get(boardIdRaw)) throw errors.notFound('target board not found');
      updates.push('board_id = ?'); vals.push(boardIdRaw);
    }
    if (!updates.length) {
      const col = sql.get.get(id);
      if (!col) throw errors.notFound('column not found');
      return res.json(col);
    }
    vals.push(id);
    const info = db.prepare(`UPDATE columns SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) throw errors.notFound('column not found');
    res.json(sql.get.get(id));
  } catch (e) { next(e); }
});

columnsRouter.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('column not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// Delete every card in a column (keeps the column). Returns count.
columnsRouter.delete('/:id/cards', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (!sql.get.get(id)) throw errors.notFound('column not found');
    const info = db.prepare('DELETE FROM cards WHERE column_id = ?').run(id);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) { next(e); }
});
