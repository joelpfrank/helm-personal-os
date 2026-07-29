-- Long-lived facts about the user that Claude carries across
-- conversations (similar to ChatGPT/Claude consumer-app memory). The
-- in-dashboard chat loads all rows into the system prompt at the start
-- of every reply, so they're always in context.

CREATE TABLE memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_memories_updated ON memories(updated_at DESC);

CREATE TRIGGER trg_memories_updated AFTER UPDATE ON memories
  BEGIN UPDATE memories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- Single-row settings table for chat-wide preferences. The
-- `personality` field is freeform user instructions for how Claude
-- should communicate (tone, style, formality, persona, etc.) and gets
-- spliced into the chat system prompt verbatim.
CREATE TABLE chat_settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  personality  TEXT    NOT NULL DEFAULT '',
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO chat_settings (id, personality) VALUES (1, '');
