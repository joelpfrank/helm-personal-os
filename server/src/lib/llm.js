// LLM backend adapter. Routes streaming chat requests to either:
//   - 'sdk' (default): the Claude Agent SDK, using Claude Code's local
//     subscription credentials; no API key needed. Plays an MCP server
//     in-process so all 95 Helm tools work natively.
//   - 'api': the original Anthropic Messages API client, kept for when
//     we commercialise (per-user API keys) or for fallback testing.
//
// The adapter exposes ONE function — `streamMessages` — that yields
// Anthropic-style stream events (content_block_start, content_block_delta,
// message_delta, etc.) regardless of which backend is in use. chat.js
// stays unaware of the swap.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../../mcp/src/tools.js';
import { simplifiedToolServer } from './simplified-chat-tools.js';
import { getExternalMcpConfig } from './external-mcp.js';
import {
  messagesStream as apiStream,
  messagesCreate as apiCreate,
  makeAssistantAccumulator,
  hasApiKey,
} from './anthropic.js';

export const BACKEND = process.env.LLM_BACKEND === 'api' ? 'api' : 'sdk';

// Built-in Claude Code tools we don't want anywhere near the Helm
// chat. The SDK ships these by default; we explicitly disallow them so
// Claude can't, e.g., shell out from the host running Helm.
// WebSearch + WebFetch are intentionally LEFT ENABLED so the coach/agents can
// look things up. We still block file/shell/etc. so it can't touch the host.
const DISALLOWED_BUILT_INS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
  'NotebookEdit', 'TodoWrite',
  'Skill', 'SlashCommand', 'Agent', 'Monitor',
];

// Cache separate full and simplified in-process MCP servers. Named/background
// agents retain the full backend; the visible Coach gets only reachable tools.
const _sdkMcpInstances = new Map();
function getSdkMcpInstance({ simplified = false } = {}) {
  const key = simplified ? 'simplified' : 'full';
  if (_sdkMcpInstances.has(key)) return _sdkMcpInstances.get(key);
  const s = new McpServer({ name: `helm-${key}`, version: '0.1.0' });
  registerTools(simplified ? simplifiedToolServer(s) : s, { simplified });
  _sdkMcpInstances.set(key, s);
  return s;
}

// Render our chat history as a single prompt to seed each SDK query.
// We can't push assistant messages back into the SDK as "history" — the
// SDK runs the agent fresh each turn — so we narrate the prior turns as
// context and end with the actual current user message that Claude
// should respond to.
function renderHistoryAsPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  // The current (latest) user turn is what Claude should respond to. The
  // earlier turns are context.
  const current = messages[messages.length - 1];
  const history = messages.slice(0, -1);
  let prompt = '';
  if (history.length) {
    prompt += '## Conversation history (for context — do not respond to these earlier turns)\n\n';
    for (const m of history) {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      prompt += `**${role}:** ${flattenContent(m.content)}\n\n`;
    }
    prompt += '---\n\n## Current turn — respond to this\n\n';
  }
  prompt += flattenContent(current.content);
  return prompt;
}

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (b.type === 'text') parts.push(b.text);
    else if (b.type === 'image') parts.push(`[image attachment: ${b.source?.media_type || 'image'}]`);
    else if (b.type === 'document') parts.push(`[document attachment: ${b.source?.media_type || 'document'}]`);
    else if (b.type === 'tool_use') parts.push(`[called tool ${b.name}(${JSON.stringify(b.input).slice(0, 120)})]`);
    else if (b.type === 'tool_result') {
      const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      parts.push(`[tool result: ${t.slice(0, 200)}]`);
    }
  }
  return parts.join(' ');
}

// Map an SDK stream event into our existing event shape so chat.js can
// keep its current consumer code untouched.
async function *sdkStream({ system, messages, model, simplifiedTools = false }) {
  // Lazy import — keeps the api-only path totally SDK-free in case the
  // package fails to load on some platform.
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const prompt = renderHistoryAsPrompt(messages);

  // Force subscription auth: drop ANTHROPIC_API_KEY from the subprocess
  // env so the bundled claude binary falls back to ~/.claude/.credentials.json.
  // Keep the API key around in our parent process so
  // autoTitle() and other one-shot API calls still have it.
  const sdkEnv = { ...process.env };
  delete sdkEnv.ANTHROPIC_API_KEY;

  const mcpServers = {
    helm: {
      type: 'sdk',
      name: 'helm',
      instance: getSdkMcpInstance({ simplified: simplifiedTools }),
    },
  };
  // User-connected external servers remain available to retained named agents,
  // but not to the visible simplified Coach.
  if (!simplifiedTools) Object.assign(mcpServers, getExternalMcpConfig());

  const opts = {
    systemPrompt: system,
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    disallowedTools: DISALLOWED_BUILT_INS,
    env: sdkEnv,
    mcpServers,
  };
  if (model) opts.model = model;

  const stream = query({ prompt, options: opts });
  for await (const msg of stream) {
    // SDKPartialAssistantMessage — pass the raw Anthropic stream event
    // straight through. Same shape chat.js already consumes.
    if (msg.type === 'stream_event' && msg.event) {
      yield msg.event;
      continue;
    }
    // SDKResultMessage — synthesize a message_stop with usage so the
    // consumer's accumulator + "done" send fire cleanly.
    if (msg.type === 'result') {
      yield {
        type: 'message_delta',
        delta: { stop_reason: msg.subtype === 'success' ? 'end_turn' : 'error' },
        usage: msg.usage || {},
      };
      yield { type: 'message_stop' };
      continue;
    }
    // SDKSystemMessage init — ignore (just session bookkeeping).
    // SDKAssistantMessage (full message) — ignore, we already saw the
    // partial events that compose it.
  }
}

export async function *streamMessages({ system, messages, tools, model, simplifiedTools = false, ...rest }) {
  if (BACKEND === 'sdk') {
    // The SDK provides its own tool routing via the in-process MCP server,
    // so the `tools` array isn't passed through.
    yield* sdkStream({ system, messages, model, simplifiedTools });
    return;
  }
  yield* apiStream({ system, messages, tools, model, ...rest });
}

// Title generation — short one-shot. The SDK's `query()` is overkill for
// a 5-token job; always route to the API for this. If the API key isn't
// configured we just skip titling.
export async function generateTitle({ prompt, maxTokens = 40 }) {
  if (!hasApiKey()) return null;
  try {
    const result = await apiCreate({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return result?.content?.[0]?.text?.trim().replace(/^["'`]+|["'`.!?]+$/g, '').slice(0, 60) || null;
  } catch { return null; }
}

// Cheap, TOOL-LESS one-shot completion — used for background reasoning like the
// self-improvement reflection step. On the SDK backend this runs the
// subscription-auth query() with NO mcp servers and all built-in tools
// disallowed, so it's pure text: no side effects, and it works without an
// ANTHROPIC_API_KEY (unlike generateTitle, which needs the API backend).
export async function completeText({ system, prompt, model = 'claude-haiku-4-5-20251001', maxTokens = 400 }) {
  if (!prompt || !String(prompt).trim()) return '';
  if (BACKEND === 'api') {
    if (!hasApiKey()) return '';
    try {
      const result = await apiCreate({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: String(prompt) }],
      });
      return result?.content?.[0]?.text?.trim() || '';
    } catch { return ''; }
  }
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const sdkEnv = { ...process.env };
    delete sdkEnv.ANTHROPIC_API_KEY;
    const opts = {
      systemPrompt: system,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      disallowedTools: DISALLOWED_BUILT_INS,
      env: sdkEnv,
      // No mcpServers → no Helm tools → pure text completion.
    };
    if (model) opts.model = model;
    let text = '';
    for await (const msg of query({ prompt: String(prompt), options: opts })) {
      if (msg.type === 'stream_event'
          && msg.event?.type === 'content_block_delta'
          && msg.event.delta?.type === 'text_delta') {
        text += msg.event.delta.text || '';
      }
    }
    return text.trim();
  } catch { return ''; }
}

// Re-export the accumulator so chat.js doesn't have to import from two
// places.
export { makeAssistantAccumulator };
