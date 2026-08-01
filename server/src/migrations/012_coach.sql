-- Coach layer: vision + multi-horizon goals + check-ins + cadence settings.
--
-- This is the Brain. It carries the user's intent (vision, identity,
-- aims, commitments) and the structured goal tree that hangs below.
-- Goals can link to existing dashboard primitives (habits/cards/
-- routines/events/etc) via the goal_links table so the rest of the
-- app becomes goal-aware.

CREATE TABLE vision (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  -- 5-10y narrative — markdown. The "who I'm becoming" story.
  north_star          TEXT    NOT NULL DEFAULT '',
  -- "I am the kind of person who..." identity statement.
  identity_statement  TEXT    NOT NULL DEFAULT '',
  -- Core values, freeform markdown bullets. (Named core_values because
  -- "values" is a reserved SQLite keyword.)
  core_values         TEXT    NOT NULL DEFAULT '',
  last_reviewed_at    TEXT,
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO vision (id) VALUES (1);

CREATE TABLE goals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id         INTEGER REFERENCES goals(id) ON DELETE CASCADE,
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',   -- the "why", markdown
  horizon           TEXT    NOT NULL DEFAULT 'quarter', -- vision|year|quarter|month|week
  status            TEXT    NOT NULL DEFAULT 'active',  -- active|done|dropped|paused
  target_date       TEXT,                                -- YYYY-MM-DD optional
  success_criteria  TEXT    NOT NULL DEFAULT '',
  position          REAL    NOT NULL DEFAULT 1000,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at      TEXT
);
CREATE INDEX idx_goals_parent   ON goals(parent_id, position);
CREATE INDEX idx_goals_horizon  ON goals(horizon, status);

-- WOOP-style obstacles + implementation intentions per goal.
CREATE TABLE goal_obstacles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id     INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  obstacle    TEXT    NOT NULL,                -- "I skip workouts when traveling"
  if_then     TEXT    NOT NULL,                -- "IF I'm in a hotel THEN 50 pushups in the room"
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_obstacles_goal ON goal_obstacles(goal_id);

-- Goal ↔ dashboard primitive (many-to-many).
CREATE TABLE goal_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id     INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,    -- habit|card|routine|event|food_target|workout
  target_id   INTEGER NOT NULL,
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_links_goal   ON goal_links(goal_id);
CREATE INDEX idx_links_target ON goal_links(kind, target_id);

-- Daily / weekly / biweekly check-ins. One of each kind per date.
CREATE TABLE check_ins (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT    NOT NULL,             -- morning|evening|weekly|biweekly_vision
  date           TEXT    NOT NULL,             -- YYYY-MM-DD
  -- JSON: { intentions, top3, wins, blockers, mood, vision_updates, ... }
  payload        TEXT    NOT NULL DEFAULT '{}',
  coach_summary  TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(kind, date)
);
CREATE INDEX idx_checkins_date ON check_ins(date DESC);

-- Coach cadence toggles. Single-row mirror of chat_settings.
CREATE TABLE coach_settings (
  id                            INTEGER PRIMARY KEY CHECK (id = 1),
  morning_enabled               INTEGER NOT NULL DEFAULT 1,
  morning_time                  TEXT    NOT NULL DEFAULT '08:00',
  evening_enabled               INTEGER NOT NULL DEFAULT 1,
  evening_time                  TEXT    NOT NULL DEFAULT '21:00',
  weekly_enabled                INTEGER NOT NULL DEFAULT 1,
  weekly_dow                    INTEGER NOT NULL DEFAULT 7,    -- ISO; 7=Sun
  vision_review_interval_days   INTEGER NOT NULL DEFAULT 14,
  updated_at                    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO coach_settings (id) VALUES (1);

CREATE TRIGGER trg_vision_updated AFTER UPDATE ON vision
  BEGIN UPDATE vision SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_goals_updated AFTER UPDATE ON goals
  BEGIN UPDATE goals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_coach_settings_updated AFTER UPDATE ON coach_settings
  BEGIN UPDATE coach_settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
