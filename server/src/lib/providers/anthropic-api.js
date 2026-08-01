import { createProviderProfile } from './contract.js';
import { MODELS, DEFAULT_MODEL_ID } from '../coach-models.js';
import { messagesStream } from '../anthropic.js';
import { createBackendStatus } from '../backend-status.js';
import { normalizeAnthropicStream } from '../provider-stream.js';

const capabilities = {
  text: true, vision: true, documents: true, tools: true, web: false, subscriptionLogin: false,
};

export const ANTHROPIC_API_PROFILE = createProviderProfile({
  id: 'anthropic:api',
  providerId: 'anthropic',
  label: 'Anthropic API',
  authClass: 'api_key',
  capabilities,
  models: MODELS.map((model) => ({ ...model, capabilities })),
  defaultModel: DEFAULT_MODEL_ID,
  status: async () => {
    const { configured, state, reason } = await createBackendStatus({ backend: 'api' }).getStatus();
    return { configured, state, reason };
  },
  stream: (request) => normalizeAnthropicStream(messagesStream({
    ...request,
    max_tokens: request.maxTokens,
  })),
  toolExecution: 'client',
});
