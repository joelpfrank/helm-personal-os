-- Food diary: per-day record (weight + manual activity) + free-form meal
-- entries with calories/macros/flags. The defining UX is chat-driven —
-- The user describes meals in plain English and Claude calls log_meal with
-- rough estimates. The UI is mostly for viewing the day.

CREATE TABLE food_days (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  date              TEXT    NOT NULL UNIQUE,
  weight_kg         REAL,
  steps             INTEGER,
  active_calories   INTEGER,
  exercise_minutes  INTEGER,
  notes             TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE meals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Denormalized so per-date queries skip the join.
  date         TEXT    NOT NULL,
  meal_type    TEXT    NOT NULL DEFAULT 'meal',   -- breakfast|lunch|dinner|snack|drink|meal
  name         TEXT    NOT NULL,
  calories     INTEGER,
  protein_g    REAL,
  carbs_g      REAL,
  fat_g        REAL,
  fiber_g      REAL,
  sugar_g      REAL,
  processed    INTEGER NOT NULL DEFAULT 0,
  organic      INTEGER NOT NULL DEFAULT 0,
  added_sugar  INTEGER NOT NULL DEFAULT 0,
  notes        TEXT    NOT NULL DEFAULT '',
  logged_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_meals_date ON meals(date);

CREATE TABLE food_settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  calorie_target     INTEGER,
  protein_g_target   REAL,
  carbs_g_target     REAL,
  fat_g_target       REAL,
  weight_goal_kg     REAL,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO food_settings (id) VALUES (1);

CREATE TRIGGER trg_food_days_updated AFTER UPDATE ON food_days
  BEGIN UPDATE food_days SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_meals_updated AFTER UPDATE ON meals
  BEGIN UPDATE meals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_food_settings_updated AFTER UPDATE ON food_settings
  BEGIN UPDATE food_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
