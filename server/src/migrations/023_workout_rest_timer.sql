CREATE TABLE workout_rest_timer (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  workout_id            INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  duration_seconds      INTEGER NOT NULL CHECK (duration_seconds BETWEEN 15 AND 3600),
  repeat_enabled        INTEGER NOT NULL DEFAULT 0 CHECK (repeat_enabled IN (0, 1)),
  notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
  next_fire_at          TEXT NOT NULL,
  started_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
