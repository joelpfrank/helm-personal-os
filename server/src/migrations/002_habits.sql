-- Habits tracker (Productive-style)
--
-- One row per habit the user is tracking. days_of_week is a CSV of ISO day
-- numbers (1=Mon … 7=Sun); the special "1,2,3,4,5,6,7" means daily.
-- goal_quantity is how many units count as "done" for a single day,
-- e.g. 8 glasses of water → 8. unit is freeform ('glass', 'min', 'page')
-- and can be empty for plain habits like "meditate".

CREATE TABLE habits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  color          TEXT,
  goal_quantity  REAL    NOT NULL DEFAULT 1,
  unit           TEXT    NOT NULL DEFAULT '',
  days_of_week   TEXT    NOT NULL DEFAULT '1,2,3,4,5,6,7',
  position       REAL    NOT NULL DEFAULT 1000,
  archived_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_habits_archived ON habits(archived_at, position);

-- One log row per discrete completion. A "8 glasses of water" day can
-- be 8 rows with quantity=1 each OR 1 row with quantity=8 — both work,
-- the API sums them.
CREATE TABLE habit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  quantity   REAL    NOT NULL DEFAULT 1,
  note       TEXT    NOT NULL DEFAULT '',
  logged_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_habit_logs_habit_date ON habit_logs(habit_id, date);
CREATE INDEX idx_habit_logs_date ON habit_logs(date);

CREATE TRIGGER trg_habits_updated AFTER UPDATE ON habits
  BEGIN UPDATE habits SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
