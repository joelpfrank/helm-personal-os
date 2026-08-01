import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import {
  intParam, requireString, optionalString, optionalNumber, rejectUnknownKeys,
} from '../lib/validate.js';
import { getBoardNested } from '../lib/repo.js';

const router = Router();

const sql = {
  list: db.prepare('SELECT id, name, position, created_at, updated_at FROM boards ORDER BY position, id'),
  get: db.prepare('SELECT id, name, position, created_at, updated_at FROM boards WHERE id = ?'),
  insert: db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)'),
  delete: db.prepare('DELETE FROM boards WHERE id = ?'),
};

router.get('/', (_req, res) => {
  res.json(sql.list.all());
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'position']);
    const name = requireString(req.body, 'name');
    const positionRaw = optionalNumber(req.body, 'position');
    const position = positionRaw == null ? appendPosition(sql.list.all()) : positionRaw;
    const info = sql.insert.run(name, position);
    res.status(201).json(sql.get.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const board = getBoardNested(id);
    if (!board) throw errors.notFound('board not found');
    res.json(board);
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['name', 'position']);
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
    if (!updates.length) {
      const board = sql.get.get(id);
      if (!board) throw errors.notFound('board not found');
      return res.json(board);
    }
    vals.push(id);
    const info = db.prepare(`UPDATE boards SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) throw errors.notFound('board not found');
    res.json(sql.get.get(id));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('board not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
