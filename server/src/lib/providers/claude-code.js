import { createProviderProfile } from './contract.js';
import { MODELS, DEFAULT_MODEL_ID } from '../coach-models.js';
import { createBackendStatus } from '../backend-status.js';
import { claudeCodeStream } from '../provider-claude-code-runtime.js';

const capabilities = {
  text: true, vision: true, documents: true, tools: true, web: true, subscriptionLogin: true,
};

export const CLAUDE_CODE_PROFILE = createProviderProfile({
  id: 'anthropic:claude-code',
  providerId: 'anthropic',
  label: 'Claude Code',
  authClass: 'subscription_cli',
  capabilities,
  models: MODELS.map((model) => ({ ...model, capabilities })),
  defaultModel: DEFAULT_MODEL_ID,
  status: async () => {
    const { configured, state, reason } = await createBackendStatus({ backend: 'sdk' }).getStatus();
    return { configured, state, reason };
  },
  stream: claudeCodeStream,
  toolExecution: 'provider',
});
