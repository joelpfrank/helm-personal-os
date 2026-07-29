// Ubiquitous self-improvement — the learn-loop every agent inherits.
//
// After an agent (the coach or any custom agent) does work, it reflects on what
// just happened and saves 0-3 durable "lessons" scoped to that agent. Those
// lessons are injected back into the agent's system prompt on future runs, so
// each agent gets sharper at its own job over time. Per-agent lessons +
// the shared `memories` bank (common facts about the user) = domain expertise
// per agent, one shared brain about the person.

import { db } from '../db.js';
import { completeText } from './llm.js';

const MAX_LESSONS_PER_AGENT = 40;   // keep each agent's lesson list tight
const REFLECT_EVERY = 8;            // reflect on a coach conversation every N stored messages

const sql = {
  list:        db.prepare('SELECT id, lesson FROM agent_lessons WHERE agent_key = ? ORDER BY id'),
  recentTexts: db.prepare('SELECT lesson FROM agent_lessons WHERE agent_key = ? ORDER BY id DESC LIMIT 60'),
  insert:      db.prepare('INSERT INTO agent_lessons (agent_key, lesson) VALUES (?, ?)'),
  count:       db.prepare('SELECT COUNT(*) AS n FROM agent_lessons WHERE agent_key = ?'),
  oldest:      db.prepare('SELECT id FROM agent_lessons WHERE agent_key = ? ORDER BY id LIMIT ?'),
};

const convSql = {
  count:  db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?'),
  recent: db.prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 8'),
};

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

export function getLessons(agentKey) {
  return sql.list.all(agentKey);
}

// The block injected into an agent's system prompt. Empty until it has learned
// something, so it changes nothing for a brand-new agent.
export function lessonsBlock(agentKey) {
  if (!agentKey) return '';
  const rows = sql.list.all(agentKey);
  if (!rows.length) return '';
  let s = `\n\n## What you've learned (improve from your own experience)\n\n`;
  s += `These are lessons you saved from your own past runs with this user. They reflect what actually works here — apply them:\n`;
  for (const r of rows) s += `  • ${r.lesson}\n`;
  return s;
}

// Extract durable lessons from what just happened and save the genuinely new
// ones. Tool-less + cheap (Haiku). Safe to call fire-and-forget.
export async function reflectAndLearn({ agentKey, role, instructions, transcript } = {}) {
  if (!agentKey || !transcript || !String(transcript).trim()) return { added: 0 };
  const existing = sql.recentTexts.all(agentKey).map((r) => r.lesson);

  const system = `You improve an AI ${role || 'agent'} by extracting durable, reusable lessons from what just happened, so it does better next time.
A good lesson is specific and generalizable — about HOW to work with this user or this kind of task (their preferences, what worked, what to avoid, a better approach). It is NOT a one-off fact about today, and NOT a restatement of the task.
Return 0-3 lessons, one per line, each starting with "- ". If there is genuinely nothing worth remembering, return exactly "NONE". Output only the lessons or NONE — no preamble.`;

  const prompt = `Agent role / instructions:
${(instructions || '(general assistant)').slice(0, 1500)}

What just happened:
${String(transcript).slice(0, 6000)}

Lessons already saved (do NOT repeat or lightly reword these):
${existing.length ? existing.map((l) => `- ${l}`).join('\n') : '(none yet)'}`;

  let out = '';
  try { out = await completeText({ system, prompt, model: 'claude-haiku-4-5-20251001', maxTokens: 300 }); }
  catch { return { added: 0 }; }
  if (!out || /^\s*none\s*$/i.test(out)) return { added: 0 };

  const seen = new Set(existing.map(norm));
  let added = 0;
  for (const raw of out.split('\n')) {
    const lesson = raw.replace(/^[-*•\d.)\s]+/, '').trim();
    if (lesson.length < 8 || lesson.length > 300) continue;
    const k = norm(lesson);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    sql.insert.run(agentKey, lesson);
    if (++added >= 3) break;
  }

  // Keep the list tight — drop the oldest beyond the cap.
  const n = sql.count.get(agentKey)?.n || 0;
  if (n > MAX_LESSONS_PER_AGENT) {
    const ids = sql.oldest.all(agentKey, n - MAX_LESSONS_PER_AGENT).map((r) => r.id);
    if (ids.length) db.prepare(`DELETE FROM agent_lessons WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
  return { added };
}

function flattenMessage(role, raw) {
  let text = '';
  try {
    const blocks = JSON.parse(raw);
    if (Array.isArray(blocks)) text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  } catch { text = String(raw || ''); }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return `${role === 'user' ? 'User' : 'Coach'}: ${text.slice(0, 800)}`;
}

// Cadenced reflection for chat/coach turns: only every REFLECT_EVERY messages,
// so it learns without a reflection call on every single message. Callers fire
// this and forget it.
export async function maybeReflectConversation({ conversationId, agentKey = 'coach', role = 'coach', instructions } = {}) {
  try {
    const n = convSql.count.get(conversationId)?.n || 0;
    if (n === 0 || n % REFLECT_EVERY !== 0) return { added: 0 };
    const rows = convSql.recent.all(conversationId).reverse();
    const transcript = rows.map((r) => flattenMessage(r.role, r.content)).filter(Boolean).join('\n');
    return await reflectAndLearn({ agentKey, role, instructions, transcript });
  } catch { return { added: 0 }; }
}
