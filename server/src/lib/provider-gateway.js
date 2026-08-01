import { createNormalizedAccumulator } from './provider-stream.js';
import { assertAiEnabled } from './providers/registry.js';

function emit(onEvent, event) {
  if (typeof onEvent === 'function') onEvent(event);
}

export async function* streamProfileMessages(profile, request) {
  assertAiEnabled();
  if (!profile || typeof profile.stream !== 'function') throw new Error('provider profile stream is required');
  yield* profile.stream(request);
}

export function assertProfileSupportsRequest(profile, { messages = [], tools = [], model } = {}) {
  const selectedModel = model == null
    ? profile.models?.find((entry) => entry.id === profile.defaultModel)
    : profile.models?.find((entry) => entry.id === model);
  if (!selectedModel) throw new Error(`provider profile ${profile.id} does not expose selected model`);
  const blocks = messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
  const required = {
    text: true,
    tools: tools.length > 0,
    vision: blocks.some((block) => block?.type === 'image'),
    documents: blocks.some((block) => block?.type === 'document'),
  };
  for (const [capability, needed] of Object.entries(required)) {
    if (!needed) continue;
    if (!profile.capabilities?.[capability]) {
      throw new Error(`provider profile ${profile.id} lacks required ${capability} capability`);
    }
    if (!selectedModel.capabilities?.[capability]) {
      throw new Error(`selected model ${selectedModel.id} lacks required ${capability} capability`);
    }
  }
}

export async function runProviderTurn({
  registry,
  profileId,
  model,
  system,
  messages = [],
  tools = [],
  runTool,
  onEvent,
  maxTurns = 12,
}) {
  assertAiEnabled();
  const profile = registry.get(profileId);
  const resolved = registry.resolveModel(profileId, model);
  assertProfileSupportsRequest(profile, { messages, tools, model: resolved.model });
  const status = await profile.getStatus();
  if (!status.configured || status.state !== 'ready') {
    throw new Error(status.reason || 'provider profile is not ready');
  }
  const workingMessages = structuredClone(messages);
  let combinedText = '';
  let final = null;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const accumulator = createNormalizedAccumulator();
    const stream = profile.stream({
      system,
      messages: workingMessages,
      tools,
      model: resolved.model,
    });
    for await (const event of stream) {
      if (event?.type === 'provider_error') throw event.error || new Error('provider stream failed');
      accumulator.onEvent(event);
      emit(onEvent, event);
    }
    final = accumulator.finalize();
    combinedText += final.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    const toolCalls = final.content.filter((block) => block.type === 'tool_call');
    if (!toolCalls.length) {
      return { ...final, text: combinedText, model: final.model || resolved.model, fallback: resolved.fallback };
    }
    workingMessages.push({ role: 'assistant', content: final.content });
    for (const call of toolCalls) {
      let content;
      let isError = false;
      try {
        content = await runTool(call.name, call.input);
      } catch {
        content = { error: 'tool_failed' };
        isError = true;
      }
      const result = {
        role: 'tool', toolCallId: call.id, name: call.name, content, isError,
      };
      workingMessages.push(result);
      emit(onEvent, { type: 'tool_result', id: call.id, name: call.name, ok: !isError });
    }
  }
  throw new Error(`provider tool loop exceeded ${maxTurns} turns`);
}
