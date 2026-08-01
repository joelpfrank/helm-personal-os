import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

process.env.HELM_STATE_DIR ||= '/tmp/helm-codex-provider-test-state';

const {
  parseCodexLoginOutput,
  normalizeCodexEvents,
  codexExecArgs,
  helmMcpConfigArgs,
  renderCodexPrompt,
  codexCliStream,
} = await import('../server/src/lib/provider-codex-cli-runtime.js');
const { createCodexCliProfile } = await import('../server/src/lib/providers/codex-cli.js');
const { providerRegistry } = await import('../server/src/lib/providers/registry.js');

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

function jsonl(events) {
  return events.map((event) => `${JSON.stringify(event)}\n`).join('');
}

// Stands in for a spawned `codex` process: emits the given stdout bytes, then
// closes with the given exit code. No subprocess is ever created.
function fakeCodex({ stdout = '', exitCode = 0, spawnError = null } = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    calls.push({ command, args, options, stdin: '' });
    child.stdout = Readable.from([Buffer.from(stdout)]);
    child.stdin = { end(value) { calls.at(-1).stdin = String(value ?? ''); } };
    queueMicrotask(() => {
      if (spawnError) child.emit('error', spawnError);
      else child.emit('close', exitCode);
    });
    return child;
  };
  return { spawnImpl, calls };
}

describe('Codex CLI subscription provider', () => {
  it('treats "Not logged in" as unauthenticated even though the CLI exits 0', () => {
    // Verified against codex-cli 0.144.6: `codex login status` prints this and
    // exits 0, so the exit code carries no signal and the substring "logged
    // in" must not be read as success.
    assert.deepEqual(
      parseCodexLoginOutput({ error: null, stdout: 'Not logged in\n', stderr: '' }),
      { ok: false, reason: 'cli_unauthenticated' },
    );
    assert.deepEqual(parseCodexLoginOutput({ stdout: 'Logged in using ChatGPT\n' }), { ok: true });
  });

  it('fails closed for a missing binary, a timeout, an expiry, and unrecognized output', () => {
    const cases = [
      [{ error: Object.assign(new Error('spawn'), { code: 'ENOENT' }) }, 'cli_missing'],
      [{ error: Object.assign(new Error('timeout'), { killed: true }) }, 'cli_timeout'],
      [{ stdout: 'Your session has expired' }, 'cli_auth_expired'],
      [{ stdout: 'something we have never seen' }, 'cli_error'],
      [{ error: new Error('boom'), stdout: '' }, 'cli_error'],
    ];
    for (const [input, reason] of cases) {
      assert.deepEqual(parseCodexLoginOutput(input), { ok: false, reason });
    }
  });

  it('never places a credential or prompt text on the command line', async () => {
    const { spawnImpl, calls } = fakeCodex({
      stdout: jsonl([{ type: 'turn.completed', usage: {} }]),
    });
    await collect(codexCliStream({
      system: 'SYSTEM-PROMPT-CANARY',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'PROMPT-CANARY' }] }],
      spawnImpl,
      env: { HELM_STATE_DIR: '/tmp/helm-codex-state', PORT: '8891' },
    }));
    const argv = calls[0].args.join(' ');
    assert.doesNotMatch(argv, /CANARY/);
    assert.match(calls[0].stdin, /SYSTEM-PROMPT-CANARY/);
    assert.match(calls[0].stdin, /PROMPT-CANARY/);
    // stderr carries raw provider text, so it is never captured at all.
    assert.equal(calls[0].options.stdio[2], 'ignore');
    // `codex exec -C` fails on a missing directory, so the scratch workspace
    // must exist by the time the CLI is spawned.
    const workspace = calls[0].args[calls[0].args.indexOf('-C') + 1];
    assert.equal(workspace, '/tmp/helm-codex-state/codex-workspace');
    assert.ok(fs.existsSync(workspace));
  });

  it('wires Helm tools through the MCP server without exposing the dashboard token', () => {
    const args = helmMcpConfigArgs({ env: { PORT: '8891', HELM_STATE_DIR: '/tmp/helm-codex-state' } });
    const argv = args.join(' ');
    assert.match(argv, /mcp_servers\.helm\.command="node"/);
    assert.match(argv, /mcp_servers\.helm\.args=\["[^"]*mcp\/src\/index\.js"\]/);
    assert.match(argv, /DASHBOARD_URL="http:\/\/127\.0\.0\.1:8891"/);
    assert.match(argv, /HELM_STATE_DIR="\/tmp\/helm-codex-state"/);
    // The MCP child resolves .dashboard-token from the state dir itself; the
    // token must never reach argv, where `ps` would expose it.
    assert.doesNotMatch(argv, /DASHBOARD_TOKEN/);
  });

  it('sandboxes the agent read-only and persists no session transcript', () => {
    const args = codexExecArgs({ model: 'gpt-5.2-codex', env: { HELM_STATE_DIR: '/tmp/helm-codex-state' } });
    assert.deepEqual(args.slice(0, 2), ['exec', '--json']);
    for (const flag of ['--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral']) {
      assert.ok(args.includes(flag), `expected ${flag}`);
    }
    assert.deepEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), ['-m', 'gpt-5.2-codex']);
  });

  it('maps a completed Codex turn onto the normalized stream contract', async () => {
    const events = await collect(normalizeCodexEvents([
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      'Reading additional input from stdin...',
      '{"type":"item.started","item":{"id":"item_0","type":"agent_message","text":"par"}}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"partial then whole"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","tool_name":"list_habits"}}',
      '{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":7,"cached_input_tokens":3}}',
    ]));
    assert.deepEqual(events, [
      { type: 'text_delta', text: 'partial then whole' },
      { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 3 }, model: null },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('reports a failed turn as a safe provider error carrying no raw provider text', async () => {
    const { spawnImpl } = fakeCodex({
      stdout: jsonl([
        { type: 'turn.started' },
        { type: 'error', message: 'unexpected status 401 Unauthorized, cf-ray: RAY-CANARY, request id: req_CANARY' },
      ]),
      exitCode: 1,
    });
    const events = await collect(codexCliStream({ messages: [{ role: 'user', content: 'hi' }], spawnImpl }));
    assert.deepEqual(events.map((event) => event.type), ['provider_error']);
    assert.equal(events[0].error.code, 'auth');
    assert.doesNotMatch(JSON.stringify(events), /CANARY|cf-ray|req_/);
  });

  it('reports a missing binary as setup rather than a generic stream failure', async () => {
    const { spawnImpl } = fakeCodex({ spawnError: Object.assign(new Error('spawn'), { code: 'ENOENT' }) });
    const events = await collect(codexCliStream({ messages: [{ role: 'user', content: 'hi' }], spawnImpl }));
    assert.deepEqual(events.map((event) => event.type), ['provider_error']);
    assert.equal(events[0].error.code, 'setup');
  });

  it('refuses to claim a turn succeeded when the CLI stops without completing one', async () => {
    const { spawnImpl } = fakeCodex({ stdout: jsonl([{ type: 'thread.started', thread_id: 't1' }]), exitCode: 0 });
    const events = await collect(codexCliStream({ messages: [{ role: 'user', content: 'hi' }], spawnImpl }));
    assert.deepEqual(events.map((event) => event.type), ['provider_error']);
  });

  it('exposes readiness without spawning an inference call, and never leaks probe output', async () => {
    let streams = 0;
    const profile = createCodexCliProfile({
      probeAuth: async () => ({ ok: false, reason: 'cli_unauthenticated' }),
      stream: () => { streams += 1; throw new Error('must not stream'); },
    });
    const status = await profile.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.reason, 'cli_unauthenticated');
    assert.match(status.setup, /codex login/);
    assert.equal(streams, 0);

    const thrown = createCodexCliProfile({ probeAuth: async () => { throw new Error('probe blew up'); } });
    assert.equal((await thrown.getStatus()).reason, 'cli_error');
    assert.doesNotMatch(JSON.stringify(await thrown.getStatus()), /blew up/);
  });

  it('is registered as a selectable subscription profile that runs its own tool loop', () => {
    const profile = providerRegistry.get('openai:codex-cli');
    assert.equal(profile.authClass, 'subscription_cli');
    assert.equal(profile.capabilities.subscriptionLogin, true);
    // Coach sends the full Helm tool list on every turn, so a profile without
    // the tools capability could never serve a Coach message.
    assert.equal(profile.capabilities.tools, true);
    assert.equal(profile.toolExecution, 'provider');
    assert.equal(profile.defaultModel, 'gpt-5.2-codex');
  });

  it('renders the system prompt and history into one prompt for a CLI that takes no message array', () => {
    const prompt = renderCodexPrompt({
      system: 'You are the coach.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'second' }] },
      ],
    });
    assert.match(prompt, /# Operating instructions\n\nYou are the coach\./);
    assert.match(prompt, /Conversation history/);
    assert.ok(prompt.indexOf('first') < prompt.indexOf('second'));
    assert.ok(prompt.endsWith('second'));
  });
});
