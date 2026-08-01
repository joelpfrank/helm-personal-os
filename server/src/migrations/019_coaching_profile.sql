-- Add structured coaching profile to coach_settings.
-- Stores motivational drivers, resistance patterns, challenge level, etc.
-- as a validated JSON text column, defaulting to {} for existing rows.

ALTER TABLE coach_settings ADD COLUMN coaching_profile TEXT NOT NULL DEFAULT '{}';
