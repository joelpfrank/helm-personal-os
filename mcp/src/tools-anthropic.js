// Bridge: expose the same tool definitions that `registerTools()` wires
// into an McpServer in a shape Anthropic's Messages API wants
// (`tools: [{ name, description, input_schema }]`), plus a `runTool`
// helper that invokes the local handler by name.
//
// Implementation note: we lean on the internal `_registeredTools` shape
// of the MCP SDK to avoid duplicating 63 tool definitions. If the SDK
// changes that internal name, this module fails loudly at startup.
// That's by design — better to break here than silently mis-call tools.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// The SDK ships a Zod v3/v4 compatible JSON-Schema converter. Reach
// for it directly (the package's wildcard `./*` export lets us).
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { z } from 'zod';
import { registerTools } from './tools.js';

const _cache = new Map();

function buildRegistry({ simplified = false } = {}) {
  const server = new McpServer({ name: 'introspector', version: '0.0.0' });
  registerTools(server, { simplified });
  const tools = server._registeredTools;
  if (!tools || typeof tools !== 'object') {
    throw new Error(
      'mcp/tools-anthropic: McpServer._registeredTools is missing — the SDK internal shape may have changed. ' +
      'Check @modelcontextprotocol/sdk; the registry now lives somewhere else.',
    );
  }
  const out = {};
  for (const [name, t] of Object.entries(tools)) {
    // The SDK normalizes whatever inputSchema we passed at registration
    // (ZodRawShape or AnySchema) into a full Zod schema with .parse() —
    // pass it straight through to zodToJsonSchema.
    const schema = t.inputSchema || z.object({});
    const jsonSchema = toJsonSchemaCompat(schema, { target: 'draft-7' });
    // Anthropic wants input_schema to be `{type: "object", properties: {...}}`.
    // toJsonSchemaCompat already gives us that shape; strip the $schema URI.
    delete jsonSchema.$schema;
    out[name] = {
      description: t.description || '',
      input_schema: jsonSchema,
      handler: t.handler,
    };
  }
  return out;
}

function registry({ simplified = false } = {}) {
  const key = simplified ? 'simplified' : 'full';
  if (!_cache.has(key)) _cache.set(key, buildRegistry({ simplified }));
  return _cache.get(key);
}

/** Anthropic-format tool list for the `tools` parameter on Messages API. */
export function getAnthropicTools() {
  return Object.entries(registry()).map(([name, def]) => ({
    name,
    description: def.description,
    input_schema: def.input_schema,
  }));
}

/** Invoke a tool by name with the given input. Returns the handler's result. */
export async function runTool(name, input, { simplified = false } = {}) {
  const def = registry({ simplified })[name];
  if (!def) throw new Error(`unknown tool: ${name}`);
  return def.handler(input || {});
}

/** Tool count (handy for sanity checks / startup logs). */
export function toolCount() {
  return Object.keys(registry()).length;
}
