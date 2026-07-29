-- Google Calendar mirror + OAuth state.
--
-- calendar_settings is a single-row table (CHECK id=1) holding the refresh
-- token, current access token (refreshed when it expires), the syncToken
-- for incremental delta sync, and which calendar we're mirroring.
--
-- events is our local mirror of Google's events table for the configured
-- range (default last 30d / next 90d). Synced every ~5 min with the
-- syncToken; create/update/delete in the dashboard writes to Google first
-- and saves locally on success.

CREATE TABLE calendar_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  calendar_id         TEXT,
  email               TEXT,
  refresh_token       TEXT,
  access_token        TEXT,
  access_expires_at   TEXT,
  sync_token          TEXT,
  last_sync_at        TEXT,
  last_sync_error     TEXT,
  authorized_at       TEXT,
  sync_from           TEXT,
  sync_to             TEXT
);

CREATE TABLE events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  google_event_id     TEXT    NOT NULL UNIQUE,
  calendar_id         TEXT    NOT NULL,
  summary             TEXT    NOT NULL DEFAULT '',
  description         TEXT    NOT NULL DEFAULT '',
  location            TEXT    NOT NULL DEFAULT '',
  start_at            TEXT    NOT NULL,
  end_at              TEXT    NOT NULL,
  all_day             INTEGER NOT NULL DEFAULT 0,
  status              TEXT    NOT NULL DEFAULT 'confirmed',
  html_link           TEXT,
  recurring_event_id  TEXT,
  etag                TEXT,
  google_updated_at   TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_start ON events(start_at);
CREATE INDEX idx_events_end ON events(end_at);
CREATE INDEX idx_events_status ON events(status);

CREATE TRIGGER trg_events_updated AFTER UPDATE ON events
  BEGIN UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
