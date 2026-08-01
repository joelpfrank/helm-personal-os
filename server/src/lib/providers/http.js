import { classifyProviderError } from '../provider-errors.js';

export function apiKeyStatus(getApiKey) {
  return typeof getApiKey() === 'string' && getApiKey().trim()
    ? { configured: true, state: 'ready', reason: null }
    : { configured: false, state: 'unconfigured', reason: 'api_key_missing' };
}

export async function* parseSseResponse(response) {
  if (!response?.ok) {
    const error = new Error('Provider request rejected');
    error.status = response?.status;
    throw error;
  }
  if (!response.body) throw new Error('Provider response stream missing');
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.match(/\r?\n\r?\n/))) {
      const frame = buffer.slice(0, boundary.index).replace(/\r/g, '');
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = frame.split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new Error('Provider SSE stream ended with an incomplete frame');
}

export async function* safeProviderStream(factory) {
  try {
    yield* factory();
  } catch (error) {
    const { code, message } = classifyProviderError(error);
    yield { type: 'provider_error', error: Object.freeze({ code, message }) };
  }
}

export function jsonText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
