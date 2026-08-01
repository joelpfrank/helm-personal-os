-- Workouts tracker (Strong-style). One sets table for both lifting and
-- cardio with disjoint nullable columns, discriminated by exercises.kind.
-- Avoids UNION queries when computing per-exercise history.

CREATE TABLE exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  kind          TEXT    NOT NULL DEFAULT 'lifting'
                  CHECK (kind IN ('lifting','cardio')),
  muscle_group  TEXT    NOT NULL DEFAULT '',
  notes         TEXT    NOT NULL DEFAULT '',
  archived_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Case-insensitive uniqueness on active exercises only — archived rows
-- can share names with new ones (e.g. you re-create "Bench Press" later).
CREATE UNIQUE INDEX idx_exercises_name_active
  ON exercises(LOWER(name)) WHERE archived_at IS NULL;
CREATE INDEX idx_exercises_kind ON exercises(kind, archived_at);

CREATE TABLE routines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  notes       TEXT    NOT NULL DEFAULT '',
  position    REAL    NOT NULL DEFAULT 1000,
  archived_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_routines_archived ON routines(archived_at, position);

CREATE TABLE routine_exercises (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id          INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id         INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position            REAL    NOT NULL DEFAULT 1000,
  target_sets         INTEGER NOT NULL DEFAULT 3,
  target_reps         INTEGER,
  target_weight       REAL,
  target_time_seconds INTEGER,
  target_distance_m   REAL,
  notes               TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_routine_exercises_routine ON routine_exercises(routine_id, position);

CREATE TABLE workouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL DEFAULT '',
  routine_id  INTEGER REFERENCES routines(id) ON DELETE SET NULL,
  started_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT,
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Partial unique index on a constant expression — at most ONE active
-- workout (ended_at IS NULL). A second insert fails with
-- SQLITE_CONSTRAINT_UNIQUE; route catches and returns 409.
CREATE UNIQUE INDEX idx_workouts_one_active
  ON workouts((1)) WHERE ended_at IS NULL;
CREATE INDEX idx_workouts_started ON workouts(started_at);

CREATE TABLE workout_exercises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id   INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position     REAL    NOT NULL DEFAULT 1000,
  notes        TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id, position);
CREATE INDEX idx_workout_exercises_exercise ON workout_exercises(exercise_id);

CREATE TABLE sets (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_exercise_id  INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  position             REAL    NOT NULL DEFAULT 1000,
  -- lifting (nullable for cardio rows)
  weight_kg            REAL,
  reps                 INTEGER,
  -- cardio (nullable for lifting rows)
  time_seconds         INTEGER,
  distance_m           REAL,
  -- shared
  rpe                  REAL,
  completed            INTEGER NOT NULL DEFAULT 0,
  is_warmup            INTEGER NOT NULL DEFAULT 0,
  note                 TEXT    NOT NULL DEFAULT '',
  completed_at         TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sets_workout_exercise ON sets(workout_exercise_id, position);

CREATE TRIGGER trg_exercises_updated  AFTER UPDATE ON exercises
  BEGIN UPDATE exercises SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_routines_updated   AFTER UPDATE ON routines
  BEGIN UPDATE routines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_workouts_updated   AFTER UPDATE ON workouts
  BEGIN UPDATE workouts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
