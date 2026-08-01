import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  createOpenAiApiProfile,
} = await import('../server/src/lib/providers/openai-api.js');
const {
  createGeminiApiProfile,
} = await import('../server/src/lib/providers/gemini-api.js');
const {
  createOpenRouterApiProfile,
} = await import('../server/src/lib/providers/openrouter-api.js');
const {
  parseSseResponse,
} = await import('../server/src/lib/providers/http.js');

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

function sse(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

describe('verified major API provider adapters', () => {
  it('parses provider SSE frames that use standard CRLF boundaries', async () => {
    const response = new Response('data: {"ok":true}\r\n\r\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

    assert.deepEqual(await collect(parseSseResponse(response)), [{ ok: true }]);
  });

  it('reports provider-specific setup without probing or exposing API credentials', async () => {
    const cases = [
      [createOpenAiApiProfile, 'OpenAI', 'OPENAI_API_KEY'],
      [createGeminiApiProfile, 'Google Gemini', 'GEMINI_API_KEY'],
      [createOpenRouterApiProfile, 'OpenRouter', 'OPENROUTER_API_KEY'],
    ];
    for (const [createProfile, provider, environmentKey] of cases) {
      let fetches = 0;
      const status = await createProfile({
        getApiKey: () => '',
        fetchImpl: async () => { fetches += 1; throw new Error('must not probe'); },
      }).getStatus();
      assert.equal(status.configured, false);
      assert.equal(status.reason, 'api_key_missing');
      assert.match(status.summary, new RegExp(provider, 'i'));
      assert.match(status.setup, new RegExp(environmentKey));
      assert.equal(fetches, 0);
      assert.doesNotMatch(JSON.stringify(status), /FIXTURE-CREDENTIAL|suffix|fingerprint/i);
    }
  });

  it('returns provider-neutral secret-safe authentication failures for every API adapter', async () => {
    const cases = [createOpenAiApiProfile, createGeminiApiProfile, createOpenRouterApiProfile];
    for (const createProfile of cases) {
      const events = await collect(createProfile({
        getApiKey: () => 'FIXTURE-CREDENTIAL',
        fetchImpl: async () => new Response('UPSTREAM-SECRET-CANARY', { status: 401 }),
      }).stream({ messages: [], tools: [] }));
      assert.deepEqual(events.map((event) => event.type), ['provider_error']);
      assert.equal(events[0].error.code, 'auth');
      assert.match(events[0].error.message, /configured provider profile/i);
      assert.doesNotMatch(JSON.stringify(events), /ANTHROPIC|Claude|UPSTREAM-SECRET-CANARY|FIXTURE-CREDENTIAL/i);
    }
  });

  it('maps an OpenAI Responses stream and client tool request through the normalized contract', async () => {
    const requests = [];
    const key = ['OPENAI', 'FIXTURE', 'CREDENTIAL'].join('-');
    const profile = createOpenAiApiProfile({
      getApiKey: () => key,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init, body: JSON.parse(init.body) });
        return new Response(sse([
          { type: 'response.created', response: { model: 'gpt-5.2' } },
          { type: 'response.output_text.delta', delta: 'Checking ' },
          { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'list_today_habits', arguments: '' } },
          { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"day":"today"}' },
          { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'list_today_habits', arguments: '{"day":"today"}' } },
          { type: 'response.completed', response: { model: 'gpt-5.2', usage: { input_tokens: 7, output_tokens: 3 } } },
        ]), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    });

    assert.equal((await profile.getStatus()).state, 'ready');
    const events = await collect(profile.stream({
      model: 'gpt-5.2',
      system: 'Use only selected Helm context.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'How are my habits?' }] }],
      tools: [{ name: 'list_today_habits', description: 'List habits', input_schema: { type: 'object', properties: {} } }],
      maxTokens: 40,
    }));

    assert.deepEqual(events, [
      { type: 'usage', usage: {}, model: 'gpt-5.2' },
      { type: 'text_delta', text: 'Checking ' },
      { type: 'tool_start', index: 1, id: 'call-1', name: 'list_today_habits' },
      { type: 'tool_input_delta', index: 1, id: 'call-1', partialJson: '{"day":"today"}' },
      { type: 'tool_end', index: 1, id: 'call-1' },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 }, model: 'gpt-5.2' },
      { type: 'done', stopReason: 'tool_use' },
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(requests[0].init.headers.authorization, `Bearer ${key}`);
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].body.max_output_tokens, 40);
    assert.equal(requests[0].body.instructions, 'Use only selected Helm context.');
    assert.deepEqual(requests[0].body.tools, [{
      type: 'function', name: 'list_today_habits', description: 'List habits', parameters: { type: 'object', properties: {} },
    }]);
    assert.doesNotMatch(JSON.stringify(requests[0].body), /OPENAI-FIXTURE-CREDENTIAL/);
  });

  it('maps a Gemini stream and function call through the normalized contract', async () => {
    const requests = [];
    const key = ['GEMINI', 'FIXTURE', 'CREDENTIAL'].join('-');
    const profile = createGeminiApiProfile({
      getApiKey: () => key,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init, body: JSON.parse(init.body) });
        return new Response([
          `data: ${JSON.stringify({
            modelVersion: 'gemini-2.5-pro',
            candidates: [{ content: { role: 'model', parts: [{ text: 'Checking ' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
          })}\n\n`,
          `data: ${JSON.stringify({
            modelVersion: 'gemini-2.5-pro',
            candidates: [{
              content: { role: 'model', parts: [{ functionCall: { name: 'list_today_habits', args: { day: 'today' } } }] },
              finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
          })}\n\n`,
        ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    });

    assert.equal((await profile.getStatus()).state, 'ready');
    const events = await collect(profile.stream({
      model: 'gemini-2.5-pro',
      system: 'Use only selected Helm context.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'How are my habits?' }] }],
      tools: [{ name: 'list_today_habits', description: 'List habits', input_schema: { type: 'object', properties: {} } }],
      maxTokens: 40,
    }));

    assert.deepEqual(events, [
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 }, model: 'gemini-2.5-pro' },
      { type: 'text_delta', text: 'Checking ' },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 }, model: 'gemini-2.5-pro' },
      { type: 'tool_start', index: 0, id: 'gemini-call-0', name: 'list_today_habits' },
      { type: 'tool_input_delta', index: 0, id: 'gemini-call-0', partialJson: '{"day":"today"}' },
      { type: 'tool_end', index: 0, id: 'gemini-call-0' },
      { type: 'done', stopReason: 'tool_use' },
    ]);
    assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    assert.equal(requests[0].init.headers['x-goog-api-key'], key);
    assert.deepEqual(requests[0].body.generationConfig, { maxOutputTokens: 40 });
    assert.deepEqual(requests[0].body.systemInstruction, { parts: [{ text: 'Use only selected Helm context.' }] });
    assert.deepEqual(requests[0].body.tools, [{ functionDeclarations: [{
      name: 'list_today_habits', description: 'List habits', parameters: { type: 'object', properties: {} },
    }] }]);
    assert.doesNotMatch(JSON.stringify(requests[0].body), /GEMINI-FIXTURE-CREDENTIAL/);
  });

  it('maps an OpenRouter chat-completions stream and tool deltas through the normalized contract', async () => {
    const requests = [];
    const key = ['OPENROUTER', 'FIXTURE', 'CREDENTIAL'].join('-');
    const profile = createOpenRouterApiProfile({
      getApiKey: () => key,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init, body: JSON.parse(init.body) });
        return new Response([
          `data: ${JSON.stringify({ model: 'openai/gpt-5.2', choices: [{ delta: { content: 'Checking ' }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ model: 'openai/gpt-5.2', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'list_today_habits', arguments: '{"day":' } }] }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ model: 'openai/gpt-5.2', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"today"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 6, completion_tokens: 3 } })}\n\n`,
          'data: [DONE]\n\n',
        ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    });

    assert.equal((await profile.getStatus()).state, 'ready');
    const events = await collect(profile.stream({
      model: 'openai/gpt-5.2',
      system: 'Use only selected Helm context.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'How are my habits?' }] }],
      tools: [{ name: 'list_today_habits', description: 'List habits', input_schema: { type: 'object', properties: {} } }],
      maxTokens: 40,
    }));

    assert.deepEqual(events, [
      { type: 'text_delta', text: 'Checking ' },
      { type: 'tool_start', index: 0, id: 'call-1', name: 'list_today_habits' },
      { type: 'tool_input_delta', index: 0, id: 'call-1', partialJson: '{"day":' },
      { type: 'tool_input_delta', index: 0, id: 'call-1', partialJson: '"today"}' },
      { type: 'usage', usage: { inputTokens: 6, outputTokens: 3 }, model: 'openai/gpt-5.2' },
      { type: 'tool_end', index: 0, id: 'call-1' },
      { type: 'done', stopReason: 'tool_use' },
    ]);
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(requests[0].init.headers.authorization, `Bearer ${key}`);
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].body.max_tokens, 40);
    assert.deepEqual(requests[0].body.messages[0], { role: 'system', content: 'Use only selected Helm context.' });
    assert.deepEqual(requests[0].body.tools, [{ type: 'function', function: {
      name: 'list_today_habits', description: 'List habits', parameters: { type: 'object', properties: {} },
    } }]);
    assert.doesNotMatch(JSON.stringify(requests[0].body), /OPENROUTER-FIXTURE-CREDENTIAL/);
  });

  it('preserves stored tool calls and results when building each provider follow-up request', async () => {
    const history = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call-7', name: 'lookup', input: { q: 'helm' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-7', content: '{"found":true}' }] },
    ];
    const captures = {};
    const profiles = [
      createOpenAiApiProfile({
        getApiKey: () => 'test',
        fetchImpl: async (_url, init) => {
          captures.openai = JSON.parse(init.body);
          return new Response(sse([{ type: 'response.completed', response: { model: 'gpt-5.2', usage: {} } }]), { status: 200 });
        },
      }),
      createGeminiApiProfile({
        getApiKey: () => 'test',
        fetchImpl: async (_url, init) => {
          captures.gemini = JSON.parse(init.body);
          return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] })}\n\n`, { status: 200 });
        },
      }),
      createOpenRouterApiProfile({
        getApiKey: () => 'test',
        fetchImpl: async (_url, init) => {
          captures.openrouter = JSON.parse(init.body);
          return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] })}\n\n`, { status: 200 });
        },
      }),
    ];
    for (const profile of profiles) await collect(profile.stream({ messages: history, tools: [] }));

    assert.deepEqual(captures.openai.input, [
      { type: 'function_call', call_id: 'call-7', name: 'lookup', arguments: '{"q":"helm"}' },
      { type: 'function_call_output', call_id: 'call-7', output: '{"found":true}' },
    ]);
    assert.deepEqual(captures.gemini.contents, [
      { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { q: 'helm' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { output: '{"found":true}' } } }] },
    ]);
    assert.deepEqual(captures.openrouter.messages, [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-7', type: 'function', function: { name: 'lookup', arguments: '{"q":"helm"}' } }] },
      { role: 'tool', tool_call_id: 'call-7', content: '{"found":true}' },
    ]);
  });
});
