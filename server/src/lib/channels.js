// Multi-channel access — "one brain everywhere".
//
// Any external channel (Telegram, CLI, WhatsApp, Slack, email...) turns an
// inbound message into a normal coach conversation turn. Because it runs
// through the exact same coach pipeline (buildSystemPrompt + streamMessages +
// the full MCP toolset) and the same single memory bank, every channel gets
// the real coach with shared memory — not a cut-down copy.

import { db } from '../db.js';
import { runCoachTurnCollectText } from '../routes/chat.js';

const sql = {
  findThread: db.prepare(
    `SELECT id FROM chat_conversations
     WHERE channel = ? AND channel_ref = ?
     ORDER BY id DESC LIMIT 1`,
  ),
  createConv: db.prepare(
    `INSERT INTO chat_conversations (title, model, channel, channel_ref)
     VALUES (?, ?, ?, ?)`,
  ),
  insertMessage: db.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)`,
  ),
  touchConv: db.prepare(
    `UPDATE chat_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ),
};

// Map an external thread (channel + its ref, e.g. a Telegram chat id) to one
// persistent Helm conversation, creating it on first contact.
export function getOrCreateChannelConversation(channel, channelRef, title) {
  const existing = sql.findThread.get(channel, channelRef);
  if (existing) return existing.id;
  const info = sql.createConv.run(title || channel, null, channel, channelRef);
  return Number(info.lastInsertRowid);
}

// Run one coach turn for an inbound channel message and return the reply text.
export async function converseOnChannel({ channel, channelRef, senderName, text, model } = {}) {
  if (!channel) throw new Error('channel required');
  if (channelRef == null || channelRef === '') throw new Error('channelRef required');
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('text required');

  const title = senderName ? `${channel} · ${senderName}` : channel;
  const conversationId = getOrCreateChannelConversation(channel, String(channelRef), title);

  sql.insertMessage.run(conversationId, 'user', JSON.stringify([{ type: 'text', text: clean }]));
  const reply = await runCoachTurnCollectText({ conversationId, model });
  sql.touchConv.run(conversationId);

  return { conversationId, reply };
}
