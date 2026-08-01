import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { intParam, requireString, rejectUnknownKeys } from '../lib/validate.js';

const router = Router();

const sql = {
  list:   db.prepare('SELECT id, text, created_at, updated_at FROM memories ORDER BY id'),
  get:    db.prepare('SELECT id, text, created_at, updated_at FROM memories WHERE id = ?'),
  insert: db.prepare('INSERT INTO memories (text) VALUES (?)'),
  update: db.prepare('UPDATE memories SET text = ? WHERE id = ?'),
  delete: db.prepare('DELETE FROM memories WHERE id = ?'),
};

router.get('/', (_req, res) => {
  res.json(sql.list.all());
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['text']);
    const text = requireString(req.body, 'text');
    const info = sql.insert.run(text);
    res.status(201).json(sql.get.get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    rejectUnknownKeys(req.body, ['text']);
    const text = requireString(req.body, 'text');
    const info = sql.update.run(text, id);
    if (info.changes === 0) throw errors.notFound('memory not found');
    res.json(sql.get.get(id));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const info = sql.delete.run(id);
    if (info.changes === 0) throw errors.notFound('memory not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---- recall: search the user's whole history ----
// Keyword search across saved memories, past conversation text, check-ins,
// and logged module items — so the coach can pull up anything from before.
const recallSql = {
  mem: db.prepare('SELECT id, text, created_at FROM memories WHERE text LIKE ? ORDER BY id DESC LIMIT 8'),
  msg: db.prepare(`
    SELECT m.id, m.role, m.content, m.created_at, c.title
    FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE m.content LIKE ? ORDER BY m.id DESC LIMIT 12
  `),
  chk: db.prepare(`
    SELECT id, kind, date, coach_summary, payload FROM check_ins
    WHERE coach_summary LIKE ? OR payload LIKE ? ORDER BY date DESC, id DESC LIMIT 8
  `),
  itm: db.prepare(`
    SELECT mi.id, mi.data, mi.created_at, m.label
    FROM module_items mi JOIN modules m ON m.id = mi.module_id
    WHERE mi.data LIKE ? ORDER BY mi.id DESC LIMIT 10
  `),
};

function textFromContent(raw) {
  try {
    const blocks = JSON.parse(raw);
    if (Array.isArray(blocks)) return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ').trim();
  } catch { /* not JSON — fall through */ }
  return String(raw || '');
}
function snip(s, n = 240) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

router.get('/recall', (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) throw errors.validation('q (search text) required');
    const coreOnly = req.query.scope === 'core';
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
    const out = [];
    for (const r of recallSql.mem.all(like)) out.push({ source: 'memory', date: r.created_at, text: snip(r.text) });
    for (const r of recallSql.msg.all(like)) {
      const t = textFromContent(r.content);
      if (t) out.push({ source: `chat${r.title ? ' · ' + r.title : ''}`, who: r.role, date: r.created_at, text: snip(t) });
    }
    for (const r of recallSql.chk.all(like, like)) out.push({ source: `check-in (${r.kind})`, date: r.date, text: snip(r.coach_summary || r.payload) });
    if (!coreOnly) {
      for (const r of recallSql.itm.all(like)) out.push({ source: `module · ${r.label}`, date: r.created_at, text: snip(r.data) });
    }
    out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    res.json({ query: q, results: out.slice(0, 25) });
  } catch (e) { next(e); }
});

// Read-only helper used by the chat route to inject memories into the
// system prompt. Returned in insertion order so memory ids line up
// with what Claude sees.
export function listMemories() {
  return sql.list.all();
}

export default router;
