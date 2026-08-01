import { db } from '../db.js';

// Reads the user's connected external MCP servers and turns the enabled ones
// into the @anthropic-ai/claude-agent-sdk mcpServers config map. Shapes match
// McpServerConfig: http/sse -> {type,url,headers?,alwaysLoad}, stdio ->
// {type:'stdio',command,args?,env?,alwaysLoad}. SDK backend only.

const sql = {
  listEnabled: db.prepare('SELECT * FROM external_mcp_servers WHERE enabled = 1 ORDER BY id'),
};

export const SECRET_MASK = '••••••';

export function parseJSON(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

export function getExternalMcpConfig() {
  let rows;
  try { rows = sql.listEnabled.all(); } catch { return {}; }
  const out = {};
  for (const r of rows) {
    const headers = parseJSON(r.headers, {});
    const env = parseJSON(r.env, {});
    const args = parseJSON(r.args, []);
    const alwaysLoad = !!r.always_load;
    const hasHeaders = headers && Object.keys(headers).length > 0;
    const hasEnv = env && Object.keys(env).length > 0;
    if (r.transport === 'http' && r.url) {
      out[r.name] = { type: 'http', url: r.url, alwaysLoad, ...(hasHeaders ? { headers } : {}) };
    } else if (r.transport === 'sse' && r.url) {
      out[r.name] = { type: 'sse', url: r.url, alwaysLoad, ...(hasHeaders ? { headers } : {}) };
    } else if (r.transport === 'stdio' && r.command) {
      out[r.name] = { type: 'stdio', command: r.command, alwaysLoad, ...(args.length ? { args } : {}), ...(hasEnv ? { env } : {}) };
    }
  }
  return out;
}

// Keep keys, hide values — for safe GETs.
export function maskSecretObject(jsonStr) {
  const obj = parseJSON(jsonStr, {});
  const masked = {};
  for (const k of Object.keys(obj)) masked[k] = obj[k] ? SECRET_MASK : obj[k];
  return masked;
}

// Merge an incoming secret object over the stored one: a value equal to the
// mask means "unchanged" (the UI round-tripped it), empty means "clear".
export function mergeSecrets(existingJson, incoming) {
  const out = { ...parseJSON(existingJson, {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === SECRET_MASK) continue;
    if (v === '' || v == null) { delete out[k]; continue; }
    out[k] = String(v);
  }
  return out;
}
