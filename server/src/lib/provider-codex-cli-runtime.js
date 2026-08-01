// Codex CLI subscription runtime.
//
// Second subscription-authenticated profile alongside Claude Code (see
// provider-claude-code-runtime.js). The same rule applies: Helm never reads,
// copies, or reimplements the provider's credentials. It shells out to the
// first-party `codex` binary, which owns its own ChatGPT/Codex sign-in, and
// reads only the JSONL event stream that `codex exec --json` prints.
//
// Helm operations reach the model the same way any other MCP client reaches
// them: Codex spawns Helm's stdio MCP server as a child process, and that
// child resolves the dashboard token from the state directory itself. No
// secret is ever placed on the `codex` command line, where `ps` would expose
// it. Only a loopback URL and the state-directory path are passed.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubAnthropicEnv } from './backend-status.js';
import { stateRoot } from './state-paths.js';
import { renderHistoryAsPrompt } from './provider-prompt.js';
import { safeProviderStream } from './providers/http.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// server/src/lib -> repo/prefix root. mcp/ and server/ are siblings in both
// the repository and an installed prefix, so this relative hop holds in both.
export const HELM_MCP_ENTRY = path.resolve(HERE, '../../../mcp/src/index.js');

export function codexBin() {
  return process.env.HELM_CODEX_BIN || 'codex';
}

// The one CLI invocation allowed for readiness: a login status check, never
// an inference command. Mirrors SDK_AUTH_PROBE in backend-status.js.
export const CODEX_AUTH_PROBE = {
  args: ['login', 'status'],
  timeoutMs: 10_000,
};

// Verified on codex-cli 0.144.6: `codex login status` prints "Not logged in"
// and still exits 0, so the exit code carries no signal and the negative
// phrase must be tested before the positive one ("Not logged in" contains
// "logged in"). Anything we do not positively recognize is unconfigured.
export function parseCodexLoginOutput({ error = null, stdout = '', stderr = '' } = {}) {
  const output = `${stdout || ''}\n${stderr || ''}`;
  if (error && error.code === 'ENOENT') return { ok: false, reason: 'cli_missing' };
  if (error && (error.killed || error.signal)) return { ok: false, reason: 'cli_timeout' };
  if (/expired/i.test(output)) return { ok: false, reason: 'cli_auth_expired' };
  if (/not logged in|logged out|not authenticated|no credential|please (log ?in|sign in)/i.test(output)) {
    return { ok: false, reason: 'cli_unauthenticated' };
  }
  if (error) return { ok: false, reason: 'cli_error' };
  if (/logged in|authenticated as|signed in/i.test(output)) return { ok: true };
  return { ok: false, reason: 'cli_error' };
}

export function defaultCodexAuthProbe() {
  return new Promise((resolve) => {
    execFile(codexBin(), CODEX_AUTH_PROBE.args, {
      timeout: CODEX_AUTH_PROBE.timeoutMs,
      env: scrubAnthropicEnv(),
    }, (error, stdout, stderr) => resolve(parseCodexLoginOutput({ error, stdout, stderr })));
  });
}

// A scratch working root for the agent, kept out of the repository and out of
// the user's home. The read-only sandbox means nothing should be written
// here; it exists so Codex never treats a real project directory as its
// workspace.
export function codexWorkspaceDir(env = process.env) {
  return path.join(stateRoot(env), 'codex-workspace');
}

// `codex exec -C` fails on a missing directory, so the scratch root is created
// on first use rather than at install time.
export function ensureCodexWorkspace(env = process.env, fileSystem = fs) {
  const dir = codexWorkspaceDir(env);
  fileSystem.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function helmMcpConfigArgs({ env = process.env, entry = HELM_MCP_ENTRY } = {}) {
  const port = Number(env.PORT || 8787);
  return [
    '-c', 'mcp_servers.helm.command="node"',
    '-c', `mcp_servers.helm.args=["${entry}"]`,
    '-c', `mcp_servers.helm.env.DASHBOARD_URL="http://127.0.0.1:${port}"`,
    // The MCP child reads .dashboard-token from this directory itself — the
    // token deliberately never appears in argv.
    ...(env.HELM_STATE_DIR ? ['-c', `mcp_servers.helm.env.HELM_STATE_DIR="${env.HELM_STATE_DIR}"`] : []),
  ];
}

export function codexExecArgs({ model, env = process.env, workspace = null } = {}) {
  return [
    'exec',
    '--json',
    // Codex's own file/shell tools stay read-only; Helm mutations go through
    // the reviewed Helm MCP tool surface, not the agent's shell.
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    // No session transcript is persisted to disk by the provider CLI.
    '--ephemeral',
    '--color', 'never',
    '-C', workspace || codexWorkspaceDir(env),
    ...(model ? ['-m', String(model)] : []),
    ...helmMcpConfigArgs({ env }),
  ];
}

function codexFailure(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

// Event vocabulary verified against codex-cli 0.144.6: thread.started,
// turn.started, turn.completed, turn.failed, item.started, item.updated,
// item.completed, error. Item types: agent_message, reasoning,
// command_execution, file_change, mcp_tool_call, web_search, todo_list.
//
// Text is emitted only on item.completed. codex does report partial items,
// but its partial payload carries the whole item rather than a guaranteed
// delta, and guessing wrong duplicates text in the stored transcript. One
// event per completed message is always correct; a turn normally produces
// several, so Coach still renders progressively.
export async function* normalizeCodexEvents(lines) {
  let sawTurn = false;
  let usage = null;
  for await (const line of lines) {
    const trimmed = String(line).trim();
    if (!trimmed) continue;
    let event;
    // codex interleaves human-readable log lines with JSONL; skip anything
    // that is not a well-formed event rather than failing the turn.
    try { event = JSON.parse(trimmed); } catch { continue; }
    if (!event || typeof event.type !== 'string') continue;

    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      const text = typeof event.item.text === 'string' ? event.item.text : '';
      if (text) yield { type: 'text_delta', text };
    } else if (event.type === 'item.completed' && event.item?.type === 'error') {
      throw codexFailure(String(event.item.message || 'Codex reported an error'));
    } else if (event.type === 'turn.completed') {
      sawTurn = true;
      usage = event.usage || null;
    } else if (event.type === 'turn.failed') {
      throw codexFailure(String(event.error?.message || event.message || 'Codex turn failed'));
    } else if (event.type === 'error') {
      throw codexFailure(String(event.message || 'Codex reported an error'));
    }
  }
  if (!sawTurn) throw codexFailure('Codex ended without completing a turn');
  yield {
    type: 'usage',
    usage: {
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      cacheReadTokens: usage?.cached_input_tokens,
    },
    model: null,
  };
  yield { type: 'done', stopReason: 'end_turn' };
}

async function* readLines(readable) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

// Prompt text is written to stdin rather than argv: it carries Helm context,
// which must not be visible in the process table.
export function spawnCodex({ args, prompt, env = process.env, spawnImpl = spawn }) {
  const child = spawnImpl(codexBin(), args, {
    env: scrubAnthropicEnv(env),
    stdio: ['pipe', 'pipe', 'ignore'], // stderr is raw provider text: never read, never logged.
  });
  child.stdin.end(prompt);
  return child;
}

// Codex exec takes no system-prompt flag, so the Coach system prompt becomes a
// labelled preamble ahead of the rendered conversation.
export function renderCodexPrompt({ system, messages }) {
  const conversation = renderHistoryAsPrompt(messages);
  if (!system) return conversation;
  return `# Operating instructions\n\n${system}\n\n---\n\n${conversation}`;
}

export function codexCliStream({ system, messages, model, spawnImpl = spawn, env = process.env }) {
  return safeProviderStream(async function* () {
    const child = spawnCodex({
      args: codexExecArgs({ model, env, workspace: ensureCodexWorkspace(env) }),
      prompt: renderCodexPrompt({ system, messages }),
      env,
      spawnImpl,
    });
    // A spawn failure closes stdout with no events, which would otherwise
    // surface as the generic "no turn" error. Record it so the more specific
    // cause wins once the stream has drained.
    let spawnError = null;
    const exited = new Promise((resolve) => {
      child.on('error', (error) => { spawnError = error; resolve(null); });
      child.on('close', (code) => resolve(code));
    });
    const failure = () => {
      if (!spawnError) return null;
      return spawnError.code === 'ENOENT'
        ? codexFailure('The Codex CLI is not installed on this server', 'setup')
        : codexFailure('Codex CLI could not be started');
    };

    let code;
    try {
      yield* normalizeCodexEvents(readLines(child.stdout));
      code = await exited;
    } catch (error) {
      await exited;
      throw failure() || error;
    }
    const spawned = failure();
    if (spawned) throw spawned;
    if (code !== 0) throw codexFailure('Codex CLI exited without completing the turn');
  });
}
