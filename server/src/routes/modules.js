import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { appendPosition } from '../lib/positions.js';
import { intParam, requireString, optionalString, rejectUnknownKeys } from '../lib/validate.js';
import { MODULE_TEMPLATES } from '../data/module-templates.js';
import { slugify } from '../lib/slug.js';

const router = Router();

const FIELD_TYPES = new Set(['text', 'number', 'bool', 'date', 'select']);

const sql = {
  listAll: db.prepare('SELECT * FROM modules ORDER BY archived_at IS NOT NULL, position, id'),
  listActive: db.prepare('SELECT * FROM modules WHERE archived_at IS NULL ORDER BY position, id'),
  get: db.prepare('SELECT * FROM modules WHERE id = ?'),
  byName: db.prepare('SELECT id FROM modules WHERE LOWER(name) = LOWER(?)'),
  insert: db.prepare(`
    INSERT INTO modules (name, label, group_name, icon, schema, config, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM modules WHERE id = ?'),

  itemsAll: db.prepare('SELECT * FROM module_items WHERE module_id = ? ORDER BY archived_at IS NOT NULL, position, id'),
  itemsActive: db.prepare('SELECT * FROM module_items WHERE module_id = ? AND archived_at IS NULL ORDER BY position, id'),
  itemGet: db.prepare('SELECT * FROM module_items WHERE id = ?'),
  itemInsert: db.prepare('INSERT INTO module_items (module_id, data, position) VALUES (?, ?, ?)'),
  itemDelete: db.prepare('DELETE FROM module_items WHERE id = ?'),
};

function parseJSON(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
function shapeModule(row) { return row ? { ...row, schema: parseJSON(row.schema, []), config: parseJSON(row.config, {}) } : null; }
function shapeItem(row) { return row ? { ...row, data: parseJSON(row.data, {}) } : null; }

// A module's schema is a constrained field-spec the generic UI + coach use.
function validateSchemaSpec(schema) {
  if (!Array.isArray(schema)) throw errors.validation('schema must be an array of field specs');
  const seen = new Set();
  for (const f of schema) {
    if (!f || typeof f !== 'object') throw errors.validation('each field must be an object');
    if (typeof f.key !== 'string' || !f.key.trim()) throw errors.validation('each field needs a non-empty key');
    if (seen.has(f.key)) throw errors.validation(`duplicate field key "${f.key}"`);
    seen.add(f.key);
    if (!FIELD_TYPES.has(f.type)) throw errors.validation(`field "${f.key}" needs type ${[...FIELD_TYPES].join('|')}`);
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
      throw errors.validation(`select field "${f.key}" needs a non-empty options array`);
    }
  }
  return schema;
}

function validateAgainstSchema(data, schema) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) throw errors.validation('data must be an object');
  const fields = new Map(schema.map((f) => [f.key, f]));
  for (const k of Object.keys(data)) {
    if (!fields.has(k)) throw errors.validation(`unknown field "${k}" for this module`);
  }
  for (const f of schema) {
    const v = data[f.key];
    if (v == null || v === '') {
      if (f.required) throw errors.validation(`field "${f.key}" is required`);
      continue;
    }
    if (f.type === 'text' && typeof v !== 'string') throw errors.validation(`field "${f.key}" must be text`);
    if (f.type === 'number' && typeof v !== 'number') throw errors.validation(`field "${f.key}" must be a number`);
    if (f.type === 'bool' && typeof v !== 'boolean') throw errors.validation(`field "${f.key}" must be true/false`);
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw errors.validation(`field "${f.key}" must be a date (YYYY-MM-DD)`);
    if (f.type === 'select' && !f.options.includes(v)) throw errors.validation(`field "${f.key}" must be one of: ${f.options.join(', ')}`);
  }
  return data;
}

// ----- modules CRUD -----
router.get('/', (req, res) => {
  const include = String(req.query.include || '');
  const rows = include === 'archived' ? sql.listAll.all() : sql.listActive.all();
  res.json(rows.map(shapeModule));
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['name', 'label', 'group_name', 'group', 'icon', 'schema', 'config']);
    const label = requireString(req.body, 'label');
    const nameRaw = optionalString(req.body, 'name');
    const name = (nameRaw && nameRaw.trim()) ? slugify(nameRaw) : slugify(label);
    if (!name) throw errors.validation('could not derive a name; provide one');
    if (sql.byName.get(name)) throw errors.conflict(`module "${name}" already exists`);
    const group = optionalString(req.body, 'group_name') ?? optionalString(req.body, 'group') ?? 'Custom';
    const icon = optionalString(req.body, 'icon') ?? '';
    const schema = validateSchemaSpec(req.body.schema ?? []);
    const config = (req.body.config && typeof req.body.config === 'object') ? req.body.config : {};
    const position = appendPosition(sql.listActive.all());
    const info = sql.insert.run(name, label, group, icon, JSON.stringify(schema), JSON.stringify(config), position);
    res.status(201).json(shapeModule(sql.get.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

// Instantiate a catalog template — copies its schema server-side so the coach
// can't mistype it, and auto-suffixes the slug so it never collides (no 409).
router.post('/from-template', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['template_key', 'label', 'group']);
    const key = requireString(req.body, 'template_key');
    const tpl = MODULE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) throw errors.notFound(`template "${key}" not found`);
    const label = optionalString(req.body, 'label') || tpl.label;
    let name = slugify(label) || slugify(tpl.key);
    if (sql.byName.get(name)) {
      let n = 2;
      while (sql.byName.get(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    const group = optionalString(req.body, 'group') || tpl.group || 'Custom';
    const schema = validateSchemaSpec(tpl.schema);
    const position = appendPosition(sql.listActive.all());
    const info = sql.insert.run(name, label, group, tpl.icon || '', JSON.stringify(schema), JSON.stringify({}), position);
    res.status(201).json(shapeModule(sql.get.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

// ----- items (specific paths first so :id doesn't swallow them) -----
router.get('/:id/items', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (!sql.get.get(id)) throw errors.notFound('module not found');
    const include = String(req.query.include || '');
    let rows = (include === 'archived' ? sql.itemsAll : sql.itemsActive).all(id).map(shapeItem);
    const q = String(req.query.q || '').toLowerCase().trim();
    if (q) rows = rows.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/:id/items', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const mod = sql.get.get(id);
    if (!mod) throw errors.notFound('module not found');
    rejectUnknownKeys(req.body, ['data']);
    const data = validateAgainstSchema(req.body.data ?? {}, parseJSON(mod.schema, []));
    const position = appendPosition(sql.itemsActive.all(id));
    const info = sql.itemInsert.run(id, JSON.stringify(data), position);
    res.status(201).json(shapeItem(sql.itemGet.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

router.patch('/item/:itemId', (req, res, next) => {
  try {
    const itemId = intParam(req.params.itemId, 'itemId');
    const item = sql.itemGet.get(itemId);
    if (!item) throw errors.notFound('item not found');
    rejectUnknownKeys(req.body, ['data', 'position', 'archived']);
    const mod = sql.get.get(item.module_id);
    const updates = [];
    const vals = [];
    if ('data' in (req.body || {})) {
      const merged = { ...parseJSON(item.data, {}), ...(req.body.data || {}) };
      const clean = validateAgainstSchema(merged, parseJSON(mod.schema, []));
      updates.push('data = ?'); vals.push(JSON.stringify(clean));
    }
    if ('position' in (req.body || {}) && typeof req.body.position === 'number') { updates.push('position = ?'); vals.push(req.body.position); }
    if ('archived' in (req.body || {})) { updates.push('archived_at = ?'); vals.push(req.body.archived ? new Date().toISOString() : null); }
    if (updates.length) { vals.push(itemId); db.prepare(`UPDATE module_items SET ${updates.join(', ')} WHERE id = ?`).run(...vals); }
    res.json(shapeItem(sql.itemGet.get(itemId)));
  } catch (e) { next(e); }
});

router.delete('/item/:itemId', (req, res, next) => {
  try {
    const itemId = intParam(req.params.itemId, 'itemId');
    const info = sql.itemDelete.run(itemId);
    if (info.changes === 0) throw errors.notFound('item not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const mod = sql.get.get(id);
    if (!mod) throw errors.notFound('module not found');
    res.json(shapeModule(mod));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (!sql.get.get(id)) throw errors.notFound('module not found');
    rejectUnknownKeys(req.body, ['label', 'group_name', 'group', 'icon', 'schema', 'config', 'position', 'archived']);
    const updates = [];
    const vals = [];
    const label = optionalString(req.body, 'label');
    if (label !== undefined) { if (!label || !label.trim()) throw errors.validation('label must be non-empty'); updates.push('label = ?'); vals.push(label.trim()); }
    const group = optionalString(req.body, 'group_name') ?? optionalString(req.body, 'group');
    if (group !== undefined) { updates.push('group_name = ?'); vals.push(group ?? 'Custom'); }
    const icon = optionalString(req.body, 'icon');
    if (icon !== undefined) { updates.push('icon = ?'); vals.push(icon ?? ''); }
    if ('schema' in (req.body || {})) { updates.push('schema = ?'); vals.push(JSON.stringify(validateSchemaSpec(req.body.schema))); }
    if ('config' in (req.body || {})) { updates.push('config = ?'); vals.push(JSON.stringify(req.body.config && typeof req.body.config === 'object' ? req.body.config : {})); }
    if ('position' in (req.body || {}) && typeof req.body.position === 'number') { updates.push('position = ?'); vals.push(req.body.position); }
    if ('archived' in (req.body || {})) { updates.push('archived_at = ?'); vals.push(req.body.archived ? new Date().toISOString() : null); }
    if (updates.length) { vals.push(id); db.prepare(`UPDATE modules SET ${updates.join(', ')} WHERE id = ?`).run(...vals); }
    res.json(shapeModule(sql.get.get(id)));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('module not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
