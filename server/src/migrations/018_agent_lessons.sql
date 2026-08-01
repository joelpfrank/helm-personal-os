-- Ubiquitous self-improvement. Every agent — the flagship coach AND any agent
-- a user spins up — accumulates its own "lessons": durable, reusable takeaways
-- extracted from its own runs so it does better next time. Lessons are scoped
-- per agent (agent_key) so each builds its own expertise, while the shared
-- `memories` table still holds the common facts about the user.
--
-- agent_key: 'coach' for the default coach, or 'agent:<id>' for a custom agent.

CREATE TABLE agent_lessons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key  TEXT NOT NULL,
  lesson     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agent_lessons_key ON agent_lessons(agent_key, id);
