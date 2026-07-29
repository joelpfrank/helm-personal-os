// Minimal Anthropic Messages-API client with streaming support.
// We only need streaming + tool use; no Files, no Batches, no SDK.

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || 4096);

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}

// Annotate the system prompt + tools array with cache_control breakpoints
// so Anthropic caches the static prefix. After the first request in a
// conversation, subsequent turns pay ~10% of the cached input cost AND
// count ~10% against the per-minute rate limit. This is the difference
// between a 5-tool-call conversation finishing cleanly vs hitting 429
// on a fresh API account (Tier 1 = 30k input tokens/min).
function annotateSystemForCache(system) {
  if (!system) return system;
  if (typeof system === 'string') {
    return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  }
  // already an array of blocks
  return system;
}
function annotateToolsForCache(tools) {
  if (!tools || !tools.length) return tools;
  const out = tools.map((t) => ({ ...t }));
  out[out.length - 1] = {
    ...out[out.length - 1],
    cache_control: { type: 'ephemeral' },
  };
  return out;
}

export class AnthropicError extends Error {
  constructor(status, body) {
    super(`Anthropic API ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

// Non-streaming POST /messages. Used for short utility calls
// (auto-titling conversations, mostly). Returns the parsed JSON response.
export async function messagesCreate({ model, system, messages, tools, max_tokens }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY not configured');
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: max_tokens || MAX_TOKENS,
    messages,
  };
  if (system) body.system = annotateSystemForCache(system);
  if (tools && tools.length) body.tools = annotateToolsForCache(tools);

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = await res.text(); }
    throw new AnthropicError(res.status, errBody);
  }
  return res.json();
}

// Streaming POST /messages. Yields parsed SSE events as `{ type, ... }`
// objects matching Anthropic's stream event format
// (message_start, content_block_start, content_block_delta,
// content_block_stop, message_delta, message_stop, ping, error).
export async function* messagesStream({ model, system, messages, tools, max_tokens }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY not configured');
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: max_tokens || MAX_TOKENS,
    messages,
    stream: true,
  };
  if (system) body.system = annotateSystemForCache(system);
  if (tools && tools.length) body.tools = annotateToolsForCache(tools);

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = await res.text(); }
    throw new AnthropicError(res.status, errBody);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE events are separated by blank lines. Within an event we look
    // for `data: <json>` lines. `event: <name>` lines are also present
    // but the JSON itself carries `type` so we ignore them.
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try { yield JSON.parse(data); }
        catch { /* skip malformed; Anthropic sometimes sends `data: ` for keepalive */ }
      }
    }
  }
}

// Reassemble the streaming events into a finalized assistant message:
//   { role: 'assistant', content: [<content blocks>], stop_reason, usage }
// content blocks: { type:'text', text } | { type:'tool_use', id, name, input }
export function makeAssistantAccumulator() {
  const blocks = [];     // content blocks indexed in stream order
  let stopReason = null;
  let usage = null;
  let model = null;

  function onEvent(evt) {
    switch (evt.type) {
      case 'message_start':
        usage = evt.message?.usage || null;
        model = evt.message?.model || null;
        break;
      case 'content_block_start': {
        const b = evt.content_block;
        if (b.type === 'text') {
          blocks[evt.index] = { type: 'text', text: '' };
        } else if (b.type === 'tool_use') {
          blocks[evt.index] = { type: 'tool_use', id: b.id, name: b.name, input: '', _partialJson: '' };
        } else {
          blocks[evt.index] = { ...b };
        }
        break;
      }
      case 'content_block_delta': {
        const block = blocks[evt.index];
        if (!block) break;
        if (evt.delta.type === 'text_delta') {
          block.text += evt.delta.text || '';
        } else if (evt.delta.type === 'input_json_delta') {
          block._partialJson += evt.delta.partial_json || '';
        }
        break;
      }
      case 'content_block_stop': {
        const block = blocks[evt.index];
        if (block && block.type === 'tool_use') {
          // Parse the accumulated JSON for the tool input.
          try { block.input = block._partialJson ? JSON.parse(block._partialJson) : {}; }
          catch { block.input = {}; }
          delete block._partialJson;
        }
        break;
      }
      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
        break;
      case 'message_stop':
        // End of stream.
        break;
    }
  }

  function finalize() {
    return {
      role: 'assistant',
      content: blocks.filter(Boolean),
      stop_reason: stopReason,
      usage,
      model,
    };
  }

  return { onEvent, finalize };
}
