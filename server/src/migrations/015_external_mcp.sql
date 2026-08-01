-- External MCP servers the coach can connect OUT to (Gmail, Notion, the user's
-- own API, etc.). Each enabled row is merged into the Agent SDK's mcpServers map
-- at chat time (server/src/lib/external-mcp.js -> lib/llm.js). SDK backend only.
-- `headers` (http/sse) and `env` (stdio) hold secrets — masked on API reads.

CREATE TABLE external_mcp_servers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,             -- slug = the mcpServers map key
  label       TEXT    NOT NULL,
  transport   TEXT    NOT NULL DEFAULT 'http',     -- http | sse | stdio
  url         TEXT,                                 -- http/sse
  command     TEXT,                                 -- stdio
  args        TEXT    NOT NULL DEFAULT '[]',        -- JSON array (stdio)
  headers     TEXT    NOT NULL DEFAULT '{}',        -- JSON object, secret (http/sse)
  env         TEXT    NOT NULL DEFAULT '{}',        -- JSON object, secret (stdio)
  always_load INTEGER NOT NULL DEFAULT 1,           -- 1 = tools always in prompt; 0 = defer behind tool-search
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER trg_external_mcp_updated AFTER UPDATE ON external_mcp_servers
  BEGIN UPDATE external_mcp_servers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
