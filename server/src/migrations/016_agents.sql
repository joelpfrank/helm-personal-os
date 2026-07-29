-- Agents & automations. An agent is a saved setup: name + instructions +
-- (optional) schedule. The coach is the implicit default agent; these are the
-- user's extra ones. A scheduled agent (automation) runs itself on a timer via
-- the in-process scheduler (routes/agents.js) and reports back; an interactive
-- agent is one you open and chat with (chat_conversations.agent_id).

CREATE TABLE agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,            -- slug
  label         TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL DEFAULT '',        -- persona/job, appended to the system prompt
  task          TEXT NOT NULL DEFAULT '',        -- what a scheduled run does each time
  schedule_freq TEXT NOT NULL DEFAULT 'manual',  -- manual | hourly | daily | weekly
  schedule_time TEXT,                            -- 'HH:MM' (daily/weekly)
  schedule_dow  INTEGER,                         -- 1-7 Mon-Sun (weekly)
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   TEXT,
  next_run_at   TEXT,
  last_status   TEXT,                            -- ok | error | running
  last_summary  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agents_sched ON agents(enabled, schedule_freq, next_run_at);
CREATE TRIGGER trg_agents_updated AFTER UPDATE ON agents
  BEGIN UPDATE agents SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TABLE agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  trigger     TEXT NOT NULL DEFAULT 'manual',    -- schedule | manual
  status      TEXT NOT NULL DEFAULT 'running',   -- running | ok | error
  summary     TEXT,
  tool_count  INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT
);
CREATE INDEX idx_agent_runs ON agent_runs(agent_id, id DESC);

-- Tie an interactive chat to an agent (null = the default coach).
ALTER TABLE chat_conversations ADD COLUMN agent_id INTEGER;
