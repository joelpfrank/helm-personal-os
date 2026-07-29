-- Flexible habit organization: group habits by time of day or by a
-- user-defined life category (Health, Work, Relationships, …).
-- time_of_day is one of morning|afternoon|evening|night|anytime
-- (enforced at the API layer); category is free text, '' = none.
-- Both are additive with safe defaults so every existing habit and
-- log is preserved untouched.

ALTER TABLE habits ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'anytime';
ALTER TABLE habits ADD COLUMN category TEXT NOT NULL DEFAULT '';
