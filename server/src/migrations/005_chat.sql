-- Per-instance Claude chat: conversation list + message log.
-- Messages store the full Anthropic content-block array as JSON so we
-- preserve text + tool_use + tool_result faithfully across reloads.

CREATE TABLE chat_conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_chat_conversations_updated ON chat_conversations(updated_at DESC);

CREATE TABLE chat_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT    NOT NULL,  -- JSON: Anthropic content-block array
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, id);

CREATE TRIGGER trg_chat_conversations_updated AFTER UPDATE ON chat_conversations
  BEGIN UPDATE chat_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_chat_messages_bump_conv AFTER INSERT ON chat_messages
  BEGIN UPDATE chat_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.conversation_id; END;
