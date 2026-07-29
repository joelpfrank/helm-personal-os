-- Per-instance language for the coach's replies ('en' | 'es'). The UI sets
-- this when the user flips the language toggle; buildSystemPrompt reads it.
ALTER TABLE chat_settings ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
