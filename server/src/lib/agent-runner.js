import { streamMessages } from './llm.js';

// Pure agent executor: run one agent turn to completion (the SDK handles the
// whole tool loop internally) and return the final text + how many tools it
// used. No DB, no HTTP — routes/agents.js wraps this with persistence.
export async function runAgentTurn({ system, task, model }) {
  const messages = [{ role: 'user', content: [{ type: 'text', text: task }] }];
  let text = '';
  let toolCount = 0;
  let stopReason = 'end_turn';
  try {
    const stream = streamMessages({ system, messages, model });
    for await (const evt of stream) {
      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        toolCount++;
      } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        text += evt.delta.text || '';
      } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
        stopReason = evt.delta.stop_reason;
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || 'stream error');
      }
    }
    return { ok: stopReason !== 'error', text: text.trim(), toolCount, stopReason };
  } catch (e) {
    return { ok: false, text: text.trim(), toolCount, error: String(e?.message || e) };
  }
}

// Next fire time for a schedule, as an ISO (UTC) string, or null for manual.
// Times and days are interpreted in the server's local timezone.
export function computeNextRun(freq, time, dow, from = new Date()) {
  if (!freq || freq === 'manual') return null;
  const base = new Date(from.getTime());

  if (freq === 'hourly') {
    const n = new Date(base);
    n.setMinutes(0, 0, 0);
    n.setHours(n.getHours() + 1);
    return n.toISOString();
  }

  const parts = String(time || '09:00').split(':');
  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const h = Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 9;
  const m = Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 0;

  if (freq === 'daily') {
    const n = new Date(base);
    n.setHours(h, m, 0, 0);
    if (n <= base) n.setDate(n.getDate() + 1);
    return n.toISOString();
  }

  if (freq === 'weekly') {
    const target = (dow >= 1 && dow <= 7) ? dow : 1; // 1=Mon..7=Sun
    const n = new Date(base);
    n.setHours(h, m, 0, 0);
    const curDow = ((n.getDay() + 6) % 7) + 1; // JS 0=Sun..6=Sat -> 1=Mon..7=Sun
    let add = (target - curDow + 7) % 7;
    if (add === 0 && n <= base) add = 7;
    n.setDate(n.getDate() + add);
    return n.toISOString();
  }

  return null;
}
