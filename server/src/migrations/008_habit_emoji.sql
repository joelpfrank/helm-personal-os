-- Per-habit emoji icon. Productive-style: a single grapheme that
-- renders next to the habit name. Stored as TEXT, defaults to ''
-- (no emoji). The frontend uses the native OS emoji keyboard via
-- maxLength=2 inputs; no picker library.

ALTER TABLE habits ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
