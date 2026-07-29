-- Multi-channel access ("one brain everywhere"). A chat_conversation can now
-- belong to an external channel (telegram, cli, whatsapp, slack, email, ...)
-- instead of only the web app. Inbound messages from any channel run through
-- the SAME coach turn (buildSystemPrompt + streamMessages), so every channel
-- gets the full coach with the SAME shared memory — nothing is reimplemented.
--
-- channel_ref is the external thread key (e.g. a Telegram chat id) used to map
-- an outside conversation to one persistent Helm conversation. Existing rows
-- default to channel='web' with a null ref, so nothing about the web app changes.

ALTER TABLE chat_conversations ADD COLUMN channel     TEXT NOT NULL DEFAULT 'web';
ALTER TABLE chat_conversations ADD COLUMN channel_ref TEXT;

CREATE INDEX idx_chat_conversations_channel ON chat_conversations(channel, channel_ref);
