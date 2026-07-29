import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import {
  intParam, requireString, optionalString, optionalColor, rejectUnknownKeys,
} from '../lib/validate.js';

const sql = {
  list: db.prepare('SELECT id, name, color FROM tags ORDER BY name'),
  get: db.prepare('SELECT id, name, color FROM tags WHERE id = ?'),
  byName: db.prepare('SELECT id, name, color FROM tags WHERE LOWER(name) = LOWER(?)'),
  insert: db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)'),
  delete: db.prepare('DELETE FROM tags WHERE id = ?'),
};

const router = Router();

router.get('/', (_req, res) => {
  res.json(sql.list.all());
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'color']);
    const name = requireString(req.body, 'name');
    const color = optionalColor(req.body, 'color') ?? '#888888';
    const existing = sql.byName.get(name);
    if (existing) throw errors.conflict(`tag "${name}" already exists`);
    const info = sql.insert.run(name, color);
    res.status(201).json(sql.get.get(info.lastInsertRowid));
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(errors.conflict('tag name already exists'));
    next(e);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['name', 'color']);
    const updates = [];
    const vals = [];
    const nameRaw = optionalString(req.body, 'name');
    if (nameRaw !== undefined) {
      if (!nameRaw || !nameRaw.trim()) throw errors.validation('name must be non-empty');
      updates.push('name = ?'); vals.push(nameRaw.trim());
    }
    const colorRaw = optionalColor(req.body, 'color');
    if (colorRaw !== undefined) {
      if (colorRaw == null) throw errors.validation('color cannot be null');
      updates.push('color = ?'); vals.push(colorRaw);
    }
    if (!updates.length) {
      const tag = sql.get.get(id);
      if (!tag) throw errors.notFound('tag not found');
      return res.json(tag);
    }
    vals.push(id);
    try {
      const info = db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      if (info.changes === 0) throw errors.notFound('tag not found');
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw errors.conflict('tag name already exists');
      throw e;
    }
    res.json(sql.get.get(id));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('tag not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
