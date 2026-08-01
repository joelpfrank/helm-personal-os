import { createProviderProfile } from './contract.js';
import { codexCliStream, defaultCodexAuthProbe } from '../provider-codex-cli-runtime.js';

// Vision and document attachments are deliberately false: `codex exec` accepts
// images only as file paths, and writing a user's attachment to disk to hand
// it to the provider is a boundary Helm does not cross today. Attaching an
// image on this profile fails with a clear capability error rather than
// silently dropping the attachment.
const capabilities = {
  text: true, vision: false, documents: false, tools: true, web: true, subscriptionLogin: true,
};

// Model ids accepted by codex-cli 0.144.6. `gpt-5.2-codex` is the CLI's own
// default. Availability still depends on the signed-in plan; an unavailable
// model surfaces as the normal provider "model" error.
const models = [
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', tier: 'frontier', capabilities },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex mini', tier: 'fast', capabilities },
];

const SIGN_IN = 'On the machine running Helm, run `codex login` and complete the ChatGPT sign-in. Set HELM_CODEX_BIN if the `codex` binary lives outside the server\'s PATH.';

export function createCodexCliProfile({ probeAuth = defaultCodexAuthProbe, stream = codexCliStream } = {}) {
  return createProviderProfile({
    id: 'openai:codex-cli',
    providerId: 'openai',
    label: 'Codex CLI',
    authClass: 'subscription_cli',
    capabilities,
    models,
    defaultModel: 'gpt-5.2-codex',
    readySummary: 'Codex CLI sign-in verified on this server. Turns draw on the signed-in ChatGPT/Codex plan allowance, not OpenAI API billing.',
    statusPresentation: {
      cli_missing: {
        summary: 'The Codex CLI is not installed on the server.',
        setup: `Install the Codex CLI so Helm can use your ChatGPT plan. ${SIGN_IN}`,
      },
      cli_unauthenticated: {
        summary: 'The Codex CLI is installed but not signed in.',
        setup: SIGN_IN,
      },
      cli_auth_expired: { summary: 'The Codex CLI sign-in has expired.', setup: `Sign in again. ${SIGN_IN}` },
      cli_timeout: {
        summary: 'Checking Codex CLI sign-in timed out.',
        setup: 'Try again in a moment. If it keeps timing out, make sure `codex login status` runs on the server (set HELM_CODEX_BIN if it lives outside PATH).',
      },
      cli_error: {
        summary: 'Could not verify the Codex CLI sign-in.',
        setup: 'Run `codex login status` on the server to verify the CLI works, then try again.',
      },
    },
    status: async () => {
      let result = null;
      try { result = await probeAuth(); } catch { result = null; }
      if (result?.ok === true) return { configured: true, state: 'ready', reason: null };
      const reason = result?.reason || 'cli_error';
      return { configured: false, state: 'unconfigured', reason };
    },
    stream,
    // Codex runs its own agent loop and calls Helm's tools through the MCP
    // server it spawns, exactly as the Claude Code profile does.
    toolExecution: 'provider',
  });
}

export const CODEX_CLI_PROFILE = createCodexCliProfile();
