-- Chat: per-conversation model + a default model on chat_settings.
--
-- Allows the user to pick Haiku / Sonnet / Opus per conversation (cheaper
-- vs more capable). When the conversation's model is NULL, the server
-- falls back to chat_settings.default_model, then to the env DEFAULT_MODEL.
--
-- Image/PDF attachments don't need new columns — they go into the existing
-- `chat_messages.content` JSON as `image` and `document` content blocks,
-- exactly the shape Anthropic's Messages API expects.

ALTER TABLE chat_conversations ADD COLUMN model TEXT;
ALTER TABLE chat_settings      ADD COLUMN default_model TEXT;
