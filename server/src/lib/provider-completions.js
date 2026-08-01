import { createNormalizedAccumulator } from './provider-stream.js';

export async function completeProfileText(profile, {
  system,
  prompt,
  model,
  maxTokens,
} = {}) {
  if (!profile || typeof profile.getStatus !== 'function' || typeof profile.stream !== 'function') return '';
  if (!prompt || !String(prompt).trim()) return '';
  try {
    const status = await profile.getStatus();
    if (!status.configured || status.state !== 'ready') return '';
    const selectedModel = profile.models?.some((entry) => entry.id === model)
      ? model
      : profile.defaultModel;
    const accumulator = createNormalizedAccumulator();
    for await (const event of profile.stream({
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: String(prompt) }] }],
      tools: [],
      model: selectedModel,
      maxTokens,
    })) {
      if (event?.type === 'provider_error' || event?.type?.startsWith('tool_')) return '';
      accumulator.onEvent(event);
    }
    const result = accumulator.finalize();
    if (result.stopReason !== 'end_turn') return '';
    return result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  } catch {
    return '';
  }
}
