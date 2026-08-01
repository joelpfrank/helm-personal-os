import { classifyProviderError } from './provider-errors.js';

function normalizeUsage(usage = {}) {
  const normalized = {};
  const input = usage.inputTokens ?? usage.input_tokens;
  const output = usage.outputTokens ?? usage.output_tokens;
  const cacheRead = usage.cacheReadTokens ?? usage.cache_read_input_tokens;
  const cacheWrite = usage.cacheWriteTokens ?? usage.cache_creation_input_tokens;
  if (Number.isFinite(input)) normalized.inputTokens = input;
  if (Number.isFinite(output)) normalized.outputTokens = output;
  if (Number.isFinite(cacheRead)) normalized.cacheReadTokens = cacheRead;
  if (Number.isFinite(cacheWrite)) normalized.cacheWriteTokens = cacheWrite;
  return normalized;
}

function streamContractError(detail) {
  const error = new Error(`provider stream contract violation: ${detail}`);
  error.code = 'provider_stream_contract';
  return error;
}

export async function* normalizeAnthropicStream(stream, { requireToolResults = false } = {}) {
  const tools = new Map();
  let stopReason = null;
  let stopped = false;
  for await (const event of stream) {
    if (stopped) throw streamContractError('event after done');
    if (event.type === 'message_start') {
      const usage = normalizeUsage(event.message?.usage);
      if (Object.keys(usage).length || event.message?.model) {
        yield { type: 'usage', usage, model: event.message?.model || null };
      }
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      if (tools.has(event.index)) throw streamContractError('duplicate tool ordering');
      const tool = { id: event.content_block.id, name: event.content_block.name };
      if (!tool.id || !tool.name) throw streamContractError('invalid tool identity');
      tools.set(event.index, { ...tool, ended: false });
      yield { type: 'tool_start', index: event.index, ...tool };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      yield { type: 'text_delta', text: event.delta.text || '' };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const tool = tools.get(event.index);
      if (!tool || tool.ended) throw streamContractError('invalid tool ordering');
      yield { type: 'tool_input_delta', index: event.index, id: tool.id, partialJson: event.delta.partial_json || '' };
    } else if (event.type === 'content_block_stop') {
      const tool = tools.get(event.index);
      if (tool) {
        if (tool.ended) throw streamContractError('duplicate tool end ordering');
        tool.ended = true;
        yield { type: 'tool_end', index: event.index, id: tool.id };
      }
    } else if (event.type === 'message_delta') {
      if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
      const usage = normalizeUsage(event.usage);
      if (Object.keys(usage).length) yield { type: 'usage', usage };
    } else if (event.type === 'message_stop') {
      if ([...tools.values()].some((tool) => !tool.ended)) throw streamContractError('unfinished tool before done');
      if (requireToolResults && [...tools.values()].some((tool) => !tool.resulted)) {
        throw streamContractError('missing tool result before done');
      }
      stopped = true;
      yield { type: 'done', stopReason: stopReason || 'end_turn' };
    } else if (event.type === 'sdk_tool_result') {
      const tool = [...tools.values()].find((entry) => entry.id === event.id);
      if (!tool || !tool.ended || tool.resulted) throw streamContractError('invalid tool result ordering');
      if (!Object.hasOwn(event, 'result')) throw streamContractError('missing tool result content');
      tool.resulted = true;
      yield { type: 'tool_result', id: tool.id, ok: event.ok === true, result: event.result };
    } else if (event.type === 'error') {
      const { code, message } = classifyProviderError(event.error);
      yield { type: 'provider_error', error: Object.freeze({ code, message }) };
    }
  }
}

export function createNormalizedAccumulator({ requireToolResults = false } = {}) {
  const content = [];
  const tools = new Map();
  let currentText = null;
  let model = null;
  let stopReason = null;
  let usage = null;
  let done = false;

  function ensureActive() {
    if (done) throw streamContractError('event after done');
  }

  function onEvent(event) {
    if (!event || typeof event.type !== 'string') throw streamContractError('invalid event');
    if (event.type !== 'done') ensureActive();
    if (event.type === 'text_delta') {
      if (typeof event.text !== 'string') throw streamContractError('invalid text delta');
      if (!currentText) {
        currentText = { type: 'text', text: '' };
        content.push(currentText);
      }
      currentText.text += event.text;
    } else if (event.type === 'tool_start') {
      currentText = null;
      if (tools.has(event.index) || !event.id || !event.name) throw streamContractError('invalid tool ordering');
      const block = {
        type: 'tool_call', id: event.id, name: event.name, input: {}, _partialJson: '', _ended: false, _resulted: false,
      };
      tools.set(event.index, block);
      content.push(block);
    } else if (event.type === 'tool_input_delta') {
      const block = tools.get(event.index);
      if (!block || block._ended || block.id !== event.id) throw streamContractError('invalid tool ordering');
      if (typeof event.partialJson !== 'string') throw streamContractError('invalid tool JSON delta');
      block._partialJson += event.partialJson;
    } else if (event.type === 'tool_end') {
      const block = tools.get(event.index);
      if (!block || block._ended || block.id !== event.id) throw streamContractError('invalid tool ordering');
      try {
        block.input = block._partialJson ? JSON.parse(block._partialJson) : {};
      } catch {
        throw streamContractError('malformed tool JSON');
      }
      if (!block.input || typeof block.input !== 'object' || Array.isArray(block.input)) {
        throw streamContractError('tool JSON must be an object');
      }
      delete block._partialJson;
      block._ended = true;
    } else if (event.type === 'usage') {
      usage = { ...(usage || {}), ...normalizeUsage(event.usage) };
      if (event.model) model = String(event.model).slice(0, 200);
    } else if (event.type === 'done') {
      if (done) throw streamContractError('duplicate done');
      if ([...tools.values()].some((block) => !block._ended)) throw streamContractError('unfinished tool before done');
      if (requireToolResults && [...tools.values()].some((block) => !block._resulted)) {
        throw streamContractError('missing tool result before done');
      }
      done = true;
      stopReason = event.stopReason || stopReason || 'end_turn';
      if (event.usage) usage = { ...(usage || {}), ...normalizeUsage(event.usage) };
    } else if (event.type === 'tool_result') {
      const block = [...tools.values()].find((entry) => entry.id === event.id);
      if (!block || !block._ended || block._resulted) throw streamContractError('invalid tool result ordering');
      if (!Object.hasOwn(event, 'result')) throw streamContractError('missing tool result content');
      block._resulted = true;
    } else if (event.type !== 'provider_error') {
      throw streamContractError('unknown event type');
    }
  }

  function result() {
    return {
      content: content.map((block) => {
        if (block.type !== 'tool_call') return block;
        const { _partialJson, _ended, _resulted, ...safe } = block;
        return safe;
      }),
      model,
      stopReason,
      usage,
    };
  }

  return {
    onEvent,
    snapshot: result,
    finalize() {
      if (!done) throw streamContractError('missing done');
      return result();
    },
  };
}
