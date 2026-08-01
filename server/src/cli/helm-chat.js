#!/usr/bin/env node
// Helm from your terminal — a tiny REPL that talks to the running dashboard's
// coach over the channel endpoint. Same coach, same shared memory as web and
// Telegram. Start the dashboard first, then:  node server/src/cli/helm-chat.js
//
// Env: PORT (default 8787), HELM_URL to override the base URL, HELM_CLI_REF to
// use a distinct conversation thread (default "local").

import readline from 'node:readline';
import { getToken } from '../auth.js';

const PORT = Number(process.env.PORT || 8787);
const BASE = process.env.HELM_URL || `http://127.0.0.1:${PORT}`;
const REF = process.env.HELM_CLI_REF || 'local';
const token = getToken();

async function send(text) {
  const r = await fetch(`${BASE}/api/channels/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: 'cli', ref: REF, text }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return `[error ${r.status}] ${data?.error?.message || 'request failed'}`;
  return data.reply || '(no reply)';
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you › ' });
console.log(`Helm CLI → ${BASE}  (thread: cli:${REF})   type /exit to quit\n`);
rl.prompt();
rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return rl.prompt();
  if (text === '/exit' || text === '/quit') return rl.close();
  try {
    const reply = await send(text);
    process.stdout.write(`\nhelm › ${reply}\n\n`);
  } catch (e) {
    process.stdout.write(`\nhelm › [error] ${e.message}\n\n`);
  }
  rl.prompt();
});
rl.on('close', () => { console.log('\nbye'); process.exit(0); });
