// Helm coach over Telegram — the coach, reachable from your phone as a bot.
//
// This integration needs its own bot token from @BotFather. Do not reuse a
// token that another process is polling because two pollers conflict. Set
// HELM_COACH_BOT_TOKEN to enable;
// with no token this stays completely dormant, so existing instances are
// unaffected. Optionally restrict access with HELM_COACH_ALLOWED_USER_ID
// (comma-separated Telegram user ids).
//
// Dependency-free: talks to the Telegram Bot API over fetch (long-poll
// getUpdates + sendMessage), so there is nothing extra to install.

import { converseOnChannel } from './channels.js';

const TOKEN = process.env.HELM_COACH_BOT_TOKEN || '';
const ALLOWED = (process.env.HELM_COACH_ALLOWED_USER_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const API = (method) => `https://api.telegram.org/bot${TOKEN}/${method}`;
let running = false;
let offset = 0;

async function tg(method, body) {
  const r = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

// Telegram caps messages at 4096 chars — split long coach replies on newlines.
function chunk(text, size = 3800) {
  let s = String(text || '');
  const out = [];
  while (s.length > size) {
    let cut = s.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s.trim()) out.push(s);
  return out.length ? out : ['(no reply)'];
}

async function handle(msg) {
  const chatId = msg.chat?.id;
  if (chatId == null) return;
  const fromId = String(msg.from?.id || '');
  if (ALLOWED.length && !ALLOWED.includes(fromId)) return;   // ignore strangers
  const text = msg.text;
  if (!text) {
    await tg('sendMessage', { chat_id: chatId, text: 'I can only read text for now.' });
    return;
  }
  try {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
    const { reply } = await converseOnChannel({
      channel: 'telegram',
      channelRef: String(chatId),
      senderName: msg.from?.first_name,
      text,
    });
    for (const part of chunk(reply)) {
      await tg('sendMessage', { chat_id: chatId, text: part });
    }
  } catch (e) {
    await tg('sendMessage', { chat_id: chatId, text: `⚠️ ${e.message || e}` });
  }
}

async function loop() {
  while (running) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      if (res?.ok && Array.isArray(res.result)) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          if (u.message) await handle(u.message);
        }
      } else if (res && res.ok === false) {
        console.error('[channels] telegram getUpdates error:', res.description);
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 3000));   // network blip — back off
    }
  }
}

export function startTelegramCoach() {
  if (!TOKEN) {
    console.log('[channels] Telegram coach disabled (set HELM_COACH_BOT_TOKEN to enable)');
    return;
  }
  if (running) return;
  running = true;
  console.log('[channels] Telegram coach bot started (long-poll)');
  loop().catch((e) => { running = false; console.error('[channels] telegram loop crashed:', e.message); });
}
