import { createProviderProfile } from './contract.js';
import { apiKeyStatus, jsonText, parseSseResponse, safeProviderStream } from './http.js';
import { resolveProviderCredential } from '../provider-secrets.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const capabilities = {
  text: true, vision: true, documents: false, tools: true, web: false, subscriptionLogin: false,
};
const models = [
  { id: 'openai/gpt-5.2', label: 'GPT-5.2 via OpenRouter', tier: 'frontier', capabilities },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro via OpenRouter', tier: 'frontier', capabilities },
];

function chatContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((block) => {
    if (block?.type === 'text') return [{ type: 'text', text: String(block.text || '') }];
    if (block?.type === 'image') {
      const source = block.source || {};
      if (source.type === 'base64' && source.media_type && source.data) {
        return [{ type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } }];
      }
    }
    return [];
  });
}

function requestMessages(system, messages = []) {
  const result = system ? [{ role: 'system', content: system }] : [];
  for (const message of messages) {
    if (message.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: message.toolCallId, content: jsonText(message.content) });
      continue;
    }
    if (Array.isArray(message.content) && message.content.some((block) => block?.type === 'tool_result')) {
      for (const block of message.content.filter((entry) => entry?.type === 'tool_result')) {
        result.push({ role: 'tool', tool_call_id: block.tool_use_id, content: jsonText(block.content) });
      }
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const text = message.content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('');
      const toolCalls = message.content.filter((block) => block?.type === 'tool_call' || block?.type === 'tool_use').map((block) => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: jsonText(block.input || {}) },
      }));
      const entry = { role: 'assistant', content: text || null };
      if (toolCalls.length) entry.tool_calls = toolCalls;
      result.push(entry);
      continue;
    }
    result.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: chatContent(message.content) });
  }
  return result;
}

function requestTools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }));
}

async function* normalizeOpenRouterResponse(response) {
  const openTools = new Map();
  let done = false;
  for await (const event of parseSseResponse(response)) {
    const choice = event.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === 'string') yield { type: 'text_delta', text: delta.content };
    for (const call of delta.tool_calls || []) {
      let open = openTools.get(call.index);
      if (!open) {
        const id = call.id;
        const name = call.function?.name;
        if (!id || !name) throw new Error('OpenRouter tool call identity missing');
        open = { id, name };
        openTools.set(call.index, open);
        yield { type: 'tool_start', index: call.index, id, name };
      }
      if (call.function?.arguments) {
        yield { type: 'tool_input_delta', index: call.index, id: open.id, partialJson: call.function.arguments };
      }
    }
    if (event.usage) {
      const usage = event.usage || {};
      yield {
        type: 'usage',
        usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
        model: event.model || null,
      };
    }
    if (choice?.finish_reason) {
      const usedTool = choice.finish_reason === 'tool_calls' || openTools.size > 0;
      for (const [index, tool] of openTools) yield { type: 'tool_end', index, id: tool.id };
      openTools.clear();
      if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('OpenRouter response ended unsuccessfully');
      done = true;
      yield { type: 'done', stopReason: usedTool ? 'tool_use' : 'end_turn' };
    }
  }
  if (!done) throw new Error('OpenRouter stream ended without a finish reason');
}

export function createOpenRouterApiProfile({
  fetchImpl = globalThis.fetch,
  getApiKey = () => resolveProviderCredential('openrouter:api'),
} = {}) {
  return createProviderProfile({
    id: 'openrouter:api',
    providerId: 'openrouter',
    label: 'OpenRouter API',
    authClass: 'api_key',
    capabilities,
    models,
    defaultModel: 'openai/gpt-5.2',
    readySummary: 'OpenRouter API key configured on the server. Requests consume OpenRouter credits.',
    statusPresentation: {
      api_key_missing: {
        summary: 'No OpenRouter API key is configured on the server.',
        setup: 'Set OPENROUTER_API_KEY in the Helm server environment. OpenRouter account connections and keys consume OpenRouter credits.',
      },
    },
    status: async () => apiKeyStatus(getApiKey),
    stream: (request) => safeProviderStream(async function* () {
      const apiKey = getApiKey();
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw Object.assign(new Error('OpenRouter API key missing'), { code: 'setup' });
      const model = request.model || 'openai/gpt-5.2';
      if (!models.some((entry) => entry.id === model)) throw Object.assign(new Error('OpenRouter model unavailable'), { code: 'model' });
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: requestMessages(request.system, request.messages),
          tools: requestTools(request.tools),
          stream: true,
          stream_options: { include_usage: true },
          ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0
            ? { max_tokens: request.maxTokens }
            : {}),
        }),
      });
      yield* normalizeOpenRouterResponse(response);
    }),
    toolExecution: 'client',
  });
}

export const OPENROUTER_API_PROFILE = createOpenRouterApiProfile();
