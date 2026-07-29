import { Router } from 'express';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import { intParam, requireString, optionalString, rejectUnknownKeys } from '../lib/validate.js';
import { buildSystemPrompt } from './chat.js';
import { runAgentTurn, computeNextRun } from '../lib/agent-runner.js';
import { reflectAndLearn } from '../lib/self-improve.js';
import { sendTelegram } from '../lib/notify.js';
import { AGENT_TEMPLATES } from '../data/agent-templates.js';

const router = Router();

const FREQS = new Set(['manual', 'hourly', 'daily', 'weekly']);

const sql = {
  list: db.prepare('SELECT * FROM agents ORDER BY id'),
  get: db.prepare('SELECT * FROM agents WHERE id = ?'),
  byName: db.prepare('SELECT id FROM agents WHERE LOWER(name) = LOWER(?)'),
  insert: db.prepare(`
    INSERT INTO agents (name, label, icon, instructions, task, schedule_freq, schedule_time, schedule_dow, enabled, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM agents WHERE id = ?'),
  setNext: db.prepare('UPDATE agents SET next_run_at = ? WHERE id = ?'),

  insertRun: db.prepare('INSERT INTO agent_runs (agent_id, trigger) VALUES (?, ?)'),
  finishRun: db.prepare(`UPDATE agent_runs SET status = ?, summary = ?, tool_count = ?, ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
  afterRun: db.prepare(`UPDATE agents SET last_status = ?, last_summary = ?, last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), next_run_at = ? WHERE id = ?`),
  markRunning: db.prepare(`UPDATE agents SET last_status = 'running' WHERE id = ?`),
  listRuns: db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 20'),

  listScheduled: db.prepare("SELECT id, schedule_freq, schedule_time, schedule_dow, next_run_at FROM agents WHERE enabled = 1 AND schedule_freq != 'manual'"),
  listDue: db.prepare("SELECT id FROM agents WHERE enabled = 1 AND schedule_freq != 'manual' AND next_run_at IS NOT NULL AND next_run_at <= ?"),
};

function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function uniqueName(base) {
  let name = base || 'agent';
  if (!sql.byName.get(name)) return name;
  let n = 2;
  while (sql.byName.get(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}

function shape(a) {
  if (!a) return null;
  return {
    id: a.id, name: a.name, label: a.label, icon: a.icon,
    kind: a.schedule_freq === 'manual' ? 'interactive' : 'scheduled',
    instructions: a.instructions, task: a.task,
    schedule_freq: a.schedule_freq, schedule_time: a.schedule_time, schedule_dow: a.schedule_dow,
    enabled: !!a.enabled,
    last_run_at: a.last_run_at, next_run_at: a.next_run_at,
    last_status: a.last_status, last_summary: a.last_summary,
    created_at: a.created_at, updated_at: a.updated_at,
  };
}

// ---- the executor: run one agent, record the run, update its state ----
const running = new Set();

export async function runAgentById(id, trigger = 'manual') {
  const agent = sql.get.get(id);
  if (!agent || !agent.enabled) return null;
  if (running.has(id)) return null;
  running.add(id);
  const runId = sql.insertRun.run(id, trigger).lastInsertRowid;
  sql.markRunning.run(id);
  const nextAfter = () => computeNextRun(agent.schedule_freq, agent.schedule_time, agent.schedule_dow);
  try {
    const system = buildSystemPrompt({ agentInstructions: agent.instructions, unattended: trigger === 'schedule', agentKey: `agent:${id}` });
    const task = (agent.task && agent.task.trim()) ? agent.task : 'Run your task now and report back to the user.';
    const { ok, text, toolCount, error } = await runAgentTurn({ system, task });
    const summary = (text || error || '(no output)').slice(0, 4000);
    const status = ok ? 'ok' : 'error';
    sql.finishRun.run(status, summary, toolCount || 0, runId);
    sql.afterRun.run(status, summary.slice(0, 600), nextAfter(), id);
    if (trigger === 'schedule') sendTelegram(`🤖 ${agent.label}\n\n${summary}`).catch(() => {});
    // Self-improvement: learn a durable lesson from this run (fire-and-forget).
    reflectAndLearn({ agentKey: `agent:${id}`, role: 'agent', instructions: agent.instructions, transcript: `Task: ${task}\n\nResult: ${summary}` }).catch(() => {});
    return { run_id: runId, status, summary };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 4000);
    sql.finishRun.run('error', msg, 0, runId);
    sql.afterRun.run('error', msg.slice(0, 600), nextAfter(), id);
    if (trigger === 'schedule') sendTelegram(`⚠️ ${agent.label} failed: ${msg.slice(0, 300)}`).catch(() => {});
    return { run_id: runId, status: 'error', summary: msg };
  } finally {
    running.delete(id);
  }
}

// ---- in-process scheduler ----
let timer = null;

export function startScheduler() {
  if (timer) return;
  try {
    for (const a of sql.listScheduled.all()) {
      if (!a.next_run_at) sql.setNext.run(computeNextRun(a.schedule_freq, a.schedule_time, a.schedule_dow), a.id);
    }
  } catch { /* table not ready yet */ }
  timer = setInterval(runDueAgents, 60 * 1000);
  if (timer.unref) timer.unref();
}

export async function runDueAgents() {
  let due;
  try { due = sql.listDue.all(new Date().toISOString()); } catch { return; }
  for (const a of due) {
    try { await runAgentById(a.id, 'schedule'); } catch { /* recorded as a failed run */ }
  }
}

// ---- routes ----
router.get('/templates', (_req, res) => {
  res.json({ templates: AGENT_TEMPLATES });
});

router.get('/', (_req, res) => {
  res.json(sql.list.all().map(shape));
});

router.post('/from-template', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['template_key', 'label']);
    const key = requireString(req.body, 'template_key');
    const tpl = AGENT_TEMPLATES.find((t) => t.key === key);
    if (!tpl) throw errors.notFound(`agent template "${key}" not found`);
    const label = optionalString(req.body, 'label') || tpl.label;
    const name = uniqueName(slugify(label) || slugify(tpl.key));
    const freq = tpl.schedule?.freq || 'manual';
    const time = tpl.schedule?.time ?? null;
    const dow = (tpl.schedule && Number.isInteger(tpl.schedule.dow)) ? tpl.schedule.dow : null;
    const next = computeNextRun(freq, time, dow);
    const info = sql.insert.run(name, label, tpl.icon || '', tpl.instructions || '', tpl.task || '', freq, time, dow, 1, next);
    res.status(201).json(shape(sql.get.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['label', 'name', 'icon', 'instructions', 'task', 'kind', 'schedule_freq', 'schedule_time', 'schedule_dow', 'enabled']);
    const label = requireString(req.body, 'label');
    const instructions = optionalString(req.body, 'instructions') ?? '';
    const icon = optionalString(req.body, 'icon') ?? '';
    const task = optionalString(req.body, 'task') ?? '';
    let freq = optionalString(req.body, 'schedule_freq') || 'manual';
    // 'kind: interactive' is shorthand for no schedule.
    if (req.body.kind === 'interactive') freq = 'manual';
    if (!FREQS.has(freq)) throw errors.validation('schedule_freq must be manual, hourly, daily, or weekly');
    const time = optionalString(req.body, 'schedule_time') ?? null;
    const dow = Number.isInteger(req.body?.schedule_dow) ? req.body.schedule_dow : null;
    if (freq !== 'manual' && !task.trim()) throw errors.validation('a scheduled agent needs a task to run');
    const enabled = req.body?.enabled === false ? 0 : 1;
    const name = uniqueName(slugify(optionalString(req.body, 'name') || label) || 'agent');
    const next = freq === 'manual' ? null : computeNextRun(freq, time, dow);
    const info = sql.insert.run(name, label, icon, instructions, task, freq, time, dow, enabled, next);
    res.status(201).json(shape(sql.get.get(info.lastInsertRowid)));
  } catch (e) { next(e); }
});

router.post('/:id/run', async (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const agent = sql.get.get(id);
    if (!agent) throw errors.notFound('agent not found');
    if (!agent.enabled) throw errors.validation('agent is disabled');
    const result = await runAgentById(id, 'manual');
    res.json(result || { status: 'skipped', summary: 'already running' });
  } catch (e) { next(e); }
});

router.get('/:id/runs', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (!sql.get.get(id)) throw errors.notFound('agent not found');
    res.json(sql.listRuns.all(id));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const agent = sql.get.get(id);
    if (!agent) throw errors.notFound('agent not found');
    rejectUnknownKeys(req.body, ['label', 'icon', 'instructions', 'task', 'schedule_freq', 'schedule_time', 'schedule_dow', 'enabled']);
    const updates = [];
    const vals = [];
    const set = (col, v) => { updates.push(`${col} = ?`); vals.push(v); };
    const label = optionalString(req.body, 'label');
    if (label !== undefined) { if (!label.trim()) throw errors.validation('label must be non-empty'); set('label', label.trim()); }
    if ('icon' in (req.body || {})) set('icon', optionalString(req.body, 'icon') ?? '');
    if ('instructions' in (req.body || {})) set('instructions', optionalString(req.body, 'instructions') ?? '');
    if ('task' in (req.body || {})) set('task', optionalString(req.body, 'task') ?? '');
    if ('schedule_freq' in (req.body || {})) {
      const f = optionalString(req.body, 'schedule_freq') || 'manual';
      if (!FREQS.has(f)) throw errors.validation('bad schedule_freq');
      set('schedule_freq', f);
    }
    if ('schedule_time' in (req.body || {})) set('schedule_time', optionalString(req.body, 'schedule_time') ?? null);
    if ('schedule_dow' in (req.body || {})) set('schedule_dow', Number.isInteger(req.body.schedule_dow) ? req.body.schedule_dow : null);
    if ('enabled' in (req.body || {})) set('enabled', req.body.enabled ? 1 : 0);
    if (updates.length) { vals.push(id); db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...vals); }
    // Recompute next_run_at from the final schedule.
    const a = sql.get.get(id);
    const next = (a.enabled && a.schedule_freq !== 'manual') ? computeNextRun(a.schedule_freq, a.schedule_time, a.schedule_dow) : null;
    sql.setNext.run(next, id);
    res.json(shape(sql.get.get(id)));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    if (sql.delete.run(id).changes === 0) throw errors.notFound('agent not found');
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
