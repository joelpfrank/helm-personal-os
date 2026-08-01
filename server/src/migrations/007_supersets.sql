-- Supersets: a tag column that groups together routine_exercises
-- (and the workout_exercises that get seeded from them) so the UI can
-- render them as a paired/alternating set.
--
-- Semantics: rows in the same routine with the same non-NULL
-- superset_group are "linked"; NULL means standalone. Group IDs are
-- arbitrary positive integers — the client picks one on link-up
-- (max-in-routine + 1). They have no separate "supersets" table; if
-- a group ever ends up with a single remaining member, the client
-- should clear that member's tag (back to NULL) for tidiness, but
-- the schema doesn't enforce that.

ALTER TABLE routine_exercises ADD COLUMN superset_group INTEGER;
ALTER TABLE workout_exercises ADD COLUMN superset_group INTEGER;
