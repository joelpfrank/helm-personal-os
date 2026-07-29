-- Explicit, durable per-habit/per-date outcomes for tri-state tracking.
--
-- Every scheduled habit/day is one of three states:
--   Achieved     → status = 'success'
--   Not achieved → status = 'failed'
--   Unspecified  → NO ROW here (absence). We NEVER store a fake 'failed' to
--                  mean "blank": Unspecified is represented by the absence or
--                  removal of a row, so a blank day is never a silent miss.
--
-- This is additive and orthogonal to habit_logs: quantity logs are untouched
-- and preserved. When an explicit outcome row exists it OVERRIDES the
-- quantity-derived status; when absent, status is derived from quantity vs.
-- goal (success when quantity >= goal, otherwise unspecified).
--
-- One row per (habit_id, date) — enforced by the UNIQUE constraint, so a PUT
-- upserts rather than piling up duplicates. FK cascade removes outcomes when
-- the habit is deleted.
CREATE TABLE habit_outcomes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('success', 'failed')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (habit_id, date)
);
CREATE INDEX idx_habit_outcomes_habit_date ON habit_outcomes(habit_id, date);
CREATE INDEX idx_habit_outcomes_date ON habit_outcomes(date);

CREATE TRIGGER trg_habit_outcomes_updated AFTER UPDATE ON habit_outcomes
  BEGIN UPDATE habit_outcomes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
