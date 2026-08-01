import { createProviderProfile } from './contract.js';
import { apiKeyStatus, jsonText, parseSseResponse, safeProviderStream } from './http.js';
import { resolveProviderCredential } from '../provider-secrets.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const capabilities = {
  text: true, vision: true, documents: false, tools: true, web: false, subscriptionLogin: false,
};
const models = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'frontier', capabilities },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast', capabilities },
];

function contentParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block?.type === 'text') return [{ text: String(block.text || '') }];
    if (block?.type === 'image') {
      const source = block.source || {};
      if (source.type === 'base64' && source.media_type && source.data) {
        return [{ inlineData: { mimeType: source.media_type, data: source.data } }];
      }
    }
    if (block?.type === 'tool_call' || block?.type === 'tool_use') {
      return [{ functionCall: { name: block.name, args: block.input || {} } }];
    }
    return [];
  });
}

function requestContents(messages = []) {
  const callNames = new Map();
  return messages.flatMap((message) => {
    if (message.role === 'tool') {
      return [{
        role: 'user',
        parts: [{ functionResponse: { name: message.name, response: { output: jsonText(message.content) } } }],
      }];
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if ((block?.type === 'tool_call' || block?.type === 'tool_use') && block.id && block.name) callNames.set(block.id, block.name);
      }
    }
    if (Array.isArray(message.content) && message.content.some((block) => block?.type === 'tool_result')) {
      return message.content.filter((block) => block?.type === 'tool_result').map((block) => ({
        role: 'user',
        parts: [{ functionResponse: {
          name: callNames.get(block.tool_use_id),
          response: { output: jsonText(block.content) },
        } }],
      }));
    }
    return [{ role: message.role === 'assistant' ? 'model' : 'user', parts: contentParts(message.content) }];
  });
}

function requestTools(tools = []) {
  if (!tools.length) return [];
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    })),
  }];
}

async function* normalizeGeminiResponse(response) {
  let usedTool = false;
  let callIndex = 0;
  let done = false;
  for await (const event of parseSseResponse(response)) {
    const usage = event.usageMetadata || {};
    if (event.modelVersion || Object.keys(usage).length) {
      yield {
        type: 'usage',
        usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount },
        model: event.modelVersion || null,
      };
    }
    const candidate = event.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
      if (typeof part.text === 'string') yield { type: 'text_delta', text: part.text };
      if (part.functionCall) {
        if (!part.functionCall.name || !part.functionCall.args || typeof part.functionCall.args !== 'object') {
          throw new Error('Gemini function call is invalid');
        }
        const index = callIndex;
        const id = `gemini-call-${callIndex}`;
        callIndex += 1;
        usedTool = true;
        yield { type: 'tool_start', index, id, name: part.functionCall.name };
        yield { type: 'tool_input_delta', index, id, partialJson: JSON.stringify(part.functionCall.args) };
        yield { type: 'tool_end', index, id };
      }
    }
    if (candidate?.finishReason) {
      if (candidate.finishReason !== 'STOP') throw new Error('Gemini response ended unsuccessfully');
      done = true;
      yield { type: 'done', stopReason: usedTool ? 'tool_use' : 'end_turn' };
    }
  }
  if (!done) throw new Error('Gemini stream ended without a terminal candidate');
}

export function createGeminiApiProfile({
  fetchImpl = globalThis.fetch,
  getApiKey = () => resolveProviderCredential('google:gemini-api'),
} = {}) {
  return createProviderProfile({
    id: 'google:gemini-api',
    providerId: 'google',
    label: 'Google Gemini API',
    authClass: 'api_key',
    capabilities,
    models,
    defaultModel: 'gemini-2.5-pro',
    readySummary: 'Google Gemini API key configured on the server. API usage is separate from Gemini consumer and CLI allowances.',
    statusPresentation: {
      api_key_missing: {
        summary: 'No Google Gemini API key is configured on the server.',
        setup: 'Set GEMINI_API_KEY in the Helm server environment. Gemini consumer and CLI allowances are not generic Gemini API credentials.',
      },
    },
    status: async () => apiKeyStatus(getApiKey),
    stream: (request) => safeProviderStream(async function* () {
      const apiKey = getApiKey();
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw Object.assign(new Error('Gemini API key missing'), { code: 'setup' });
      const model = request.model || 'gemini-2.5-pro';
      if (!models.some((entry) => entry.id === model)) throw Object.assign(new Error('Gemini model unavailable'), { code: 'model' });
      const body = {
        systemInstruction: request.system ? { parts: [{ text: request.system }] } : undefined,
        contents: requestContents(request.messages),
        tools: requestTools(request.tools),
        ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0
          ? { generationConfig: { maxOutputTokens: request.maxTokens } }
          : {}),
      };
      const response = await fetchImpl(`${BASE_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      yield* normalizeGeminiResponse(response);
    }),
    toolExecution: 'client',
  });
}

export const GEMINI_API_PROFILE = createGeminiApiProfile();
