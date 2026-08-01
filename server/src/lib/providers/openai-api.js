import { createProviderProfile } from './contract.js';
import { apiKeyStatus, jsonText, parseSseResponse, safeProviderStream } from './http.js';
import { resolveProviderCredential } from '../provider-secrets.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const capabilities = {
  text: true, vision: true, documents: false, tools: true, web: false, subscriptionLogin: false,
};
const models = [
  { id: 'gpt-5.2', label: 'GPT-5.2', tier: 'frontier', capabilities },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'fast', capabilities },
];

function textParts(content, type) {
  if (typeof content === 'string') return [{ type, text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block?.type === 'text') return [{ type, text: String(block.text || '') }];
    if (block?.type === 'image' && type === 'input_text') {
      const source = block.source || {};
      if (source.type === 'base64' && source.media_type && source.data) {
        return [{ type: 'input_image', image_url: `data:${source.media_type};base64,${source.data}` }];
      }
    }
    return [];
  });
}

function inputItems(messages = []) {
  return messages.flatMap((message) => {
    if (message.role === 'tool') {
      return [{ type: 'function_call_output', call_id: message.toolCallId, output: jsonText(message.content) }];
    }
    if (Array.isArray(message.content) && message.content.some((block) => block?.type === 'tool_result')) {
      return message.content.filter((block) => block?.type === 'tool_result').map((block) => ({
        type: 'function_call_output', call_id: block.tool_use_id, output: jsonText(block.content),
      }));
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const items = [];
      const text = textParts(message.content, 'output_text');
      if (text.length) items.push({ role: 'assistant', content: text });
      for (const block of message.content) {
        if (block?.type === 'tool_call' || block?.type === 'tool_use') {
          items.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: jsonText(block.input || {}) });
        }
      }
      return items;
    }
    return [{ role: message.role === 'assistant' ? 'assistant' : 'user', content: textParts(message.content, message.role === 'assistant' ? 'output_text' : 'input_text') }];
  });
}

function requestTools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description || '',
    parameters: tool.input_schema || { type: 'object', properties: {} },
  }));
}

async function* normalizeOpenAiResponse(response) {
  const openTools = new Map();
  let usedTool = false;
  for await (const event of parseSseResponse(response)) {
    if (event.type === 'response.created') {
      yield { type: 'usage', usage: {}, model: event.response?.model || null };
    } else if (event.type === 'response.output_text.delta') {
      yield { type: 'text_delta', text: event.delta || '' };
    } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const id = event.item.call_id || event.item.id;
      if (!id || !event.item.name) throw new Error('OpenAI function call identity missing');
      openTools.set(event.output_index, id);
      usedTool = true;
      yield { type: 'tool_start', index: event.output_index, id, name: event.item.name };
      if (event.item.arguments) {
        yield { type: 'tool_input_delta', index: event.output_index, id, partialJson: event.item.arguments };
      }
    } else if (event.type === 'response.function_call_arguments.delta') {
      const id = openTools.get(event.output_index);
      if (!id) throw new Error('OpenAI function arguments arrived out of order');
      yield { type: 'tool_input_delta', index: event.output_index, id, partialJson: event.delta || '' };
    } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const id = openTools.get(event.output_index);
      if (!id) throw new Error('OpenAI function call ended out of order');
      openTools.delete(event.output_index);
      yield { type: 'tool_end', index: event.output_index, id };
    } else if (event.type === 'response.completed') {
      if (openTools.size) throw new Error('OpenAI response completed with unfinished function calls');
      const usage = event.response?.usage || {};
      yield {
        type: 'usage',
        usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
        model: event.response?.model || null,
      };
      yield { type: 'done', stopReason: usedTool ? 'tool_use' : 'end_turn' };
    } else if (event.type === 'error' || event.type === 'response.failed') {
      const error = new Error('OpenAI response failed');
      error.status = event.error?.status;
      throw error;
    }
  }
}

export function createOpenAiApiProfile({
  fetchImpl = globalThis.fetch,
  getApiKey = () => resolveProviderCredential('openai:api'),
} = {}) {
  return createProviderProfile({
    id: 'openai:api',
    providerId: 'openai',
    label: 'OpenAI API',
    authClass: 'api_key',
    capabilities,
    models,
    defaultModel: 'gpt-5.2',
    readySummary: 'OpenAI API key configured on the server. API usage is billed separately from ChatGPT subscriptions.',
    statusPresentation: {
      api_key_missing: {
        summary: 'No OpenAI API key is configured on the server.',
        setup: 'Set OPENAI_API_KEY in the Helm server environment. OpenAI API billing is separate from ChatGPT subscriptions.',
      },
    },
    status: async () => apiKeyStatus(getApiKey),
    stream: (request) => safeProviderStream(async function* () {
      const apiKey = getApiKey();
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw Object.assign(new Error('OpenAI API key missing'), { code: 'setup' });
      const body = {
        model: request.model || 'gpt-5.2',
        instructions: request.system || undefined,
        input: inputItems(request.messages),
        tools: requestTools(request.tools),
        stream: true,
        ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0
          ? { max_output_tokens: request.maxTokens }
          : {}),
      };
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      yield* normalizeOpenAiResponse(response);
    }),
    toolExecution: 'client',
  });
}

export const OPENAI_API_PROFILE = createOpenAiApiProfile();
