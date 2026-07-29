-- Custom modules: user- or AI-defined mini-apps (a data schema + items).
-- Additive substrate — built-in collections (Tasks/Habits/Food…) stay as-is.
-- A module's `schema` is a constrained field-spec the generic UI + coach use:
--   [{ "key":"title", "label":"Title", "type":"text", "required":true },
--    { "key":"rating", "label":"Rating", "type":"number" },
--    { "key":"status", "label":"Status", "type":"select", "options":["a","b"] }]
-- Field types: text | number | bool | date | select.

CREATE TABLE modules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,                 -- slug (lowercased), used by the coach
  label       TEXT    NOT NULL,                        -- display name in the Library
  group_name  TEXT    NOT NULL DEFAULT 'Custom',       -- 'group' is a reserved word
  icon        TEXT    NOT NULL DEFAULT '',
  schema      TEXT    NOT NULL DEFAULT '[]',           -- JSON field-spec array
  config      TEXT    NOT NULL DEFAULT '{}',           -- JSON view options (primary_field, etc.)
  position    REAL    NOT NULL DEFAULT 1000,
  archived_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_modules_archived ON modules(archived_at, position);
CREATE TRIGGER trg_modules_updated AFTER UPDATE ON modules
  BEGIN UPDATE modules SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TABLE module_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  data        TEXT    NOT NULL DEFAULT '{}',           -- JSON keyed by schema field keys
  position    REAL    NOT NULL DEFAULT 1000,
  archived_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_module_items_module ON module_items(module_id, archived_at, position);
CREATE TRIGGER trg_module_items_updated AFTER UPDATE ON module_items
  BEGIN UPDATE module_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
