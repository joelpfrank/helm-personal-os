import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../../mcp/src/tools.js';
import { simplifiedToolServer } from './simplified-chat-tools.js';
import { getExternalMcpConfig } from './external-mcp.js';
import { scrubAnthropicEnv } from './backend-status.js';
import { normalizeAnthropicStream } from './provider-stream.js';
import { renderHistoryAsPrompt } from './provider-prompt.js';

const DISALLOWED_BUILT_INS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
  'NotebookEdit', 'TodoWrite',
  'Skill', 'SlashCommand', 'Agent', 'Monitor',
];

const sdkMcpInstances = new Map();
function getSdkMcpInstance({ simplified = false } = {}) {
  const key = simplified ? 'simplified' : 'full';
  if (sdkMcpInstances.has(key)) return sdkMcpInstances.get(key);
  const server = new McpServer({ name: `helm-${key}`, version: '0.0.0' });
  registerTools(simplified ? simplifiedToolServer(server) : server, { simplified });
  sdkMcpInstances.set(key, server);
  return server;
}

export function sdkToolResultEvents(message) {
  if (message?.type !== 'user' || !Array.isArray(message.message?.content)) return [];
  return message.message.content.flatMap((block) => {
    if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string' || !block.tool_use_id) return [];
    return [{
      type: 'sdk_tool_result',
      id: block.tool_use_id,
      ok: block.is_error !== true,
      result: block.content === undefined ? [] : block.content,
    }];
  });
}

export async function* claudeCodeStream({ system, messages, model, simplifiedTools = false }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const mcpServers = {
    helm: {
      type: 'sdk',
      name: 'helm',
      instance: getSdkMcpInstance({ simplified: simplifiedTools }),
    },
  };
  if (!simplifiedTools) Object.assign(mcpServers, getExternalMcpConfig());
  const options = {
    systemPrompt: system,
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    disallowedTools: DISALLOWED_BUILT_INS,
    env: scrubAnthropicEnv(),
    mcpServers,
  };
  if (model) options.model = model;

  const raw = (async function* () {
    let turn = 0;
    for await (const message of query({ prompt: renderHistoryAsPrompt(messages), options })) {
      if (message.type === 'stream_event' && message.event) {
        if (message.event.type === 'message_stop') {
          turn += 1;
          continue;
        }
        const event = Number.isInteger(message.event.index)
          ? { ...message.event, index: `${turn}:${message.event.index}` }
          : message.event;
        yield event;
      } else if (message.type === 'user') {
        yield* sdkToolResultEvents(message);
      } else if (message.type === 'result') {
        if (message.subtype !== 'success') throw new Error('Claude Code provider failed');
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: message.usage || {} };
        yield { type: 'message_stop' };
      }
    }
  }());
  yield* normalizeAnthropicStream(raw, { requireToolResults: true });
}

export async function completeClaudeCodeText({ system, prompt, model }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const options = {
    systemPrompt: system,
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    disallowedTools: DISALLOWED_BUILT_INS,
    env: scrubAnthropicEnv(),
  };
  if (model) options.model = model;
  let text = '';
  for await (const message of query({ prompt: String(prompt), options })) {
    if (message.type === 'stream_event'
        && message.event?.type === 'content_block_delta'
        && message.event.delta?.type === 'text_delta') text += message.event.delta.text || '';
  }
  return text.trim();
}
