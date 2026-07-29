// TDD tests: closing the simplified visible Coach recall boundary gap.
// RED first — the simplified Coach's `recall` tool must be blocked from
// surfacing custom-module data on BOTH the API and SDK chat backends, while
// retained named/background agents and standalone MCP keep full recall
// (including module results) unchanged.
//
// Isolated DB + the real Express app, same pattern as
// coach-briefing-tasks.test.mjs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-recall-boundary-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP, 'test.db');

const QUERY = 'zzzrecallprobeunique';

let server, db, registerTools, runTool, simplifiedToolServer;

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

before(async () => {
  const port = await reservePort();
  process.env.DASHBOARD_URL = `http://127.0.0.1:${port}`;
  const dbMod = await import('../server/src/db.js');
  assert.equal(path.dirname(dbMod.db.name), TMP,
    `refusing to run: db.js opened ${dbMod.db.name}, not the isolated test DB`);
  dbMod.runMigrations();
  db = dbMod.db;

  const { getToken } = await import('../server/src/auth.js');
  const { createApp } = await import('../server/src/app.js');
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(port, '127.0.0.1', resolve); });

  process.env.DASHBOARD_TOKEN = getToken();

  // Fixtures: one row of each recall source, all matching QUERY.
  db.prepare('INSERT INTO memories (text) VALUES (?)').run(`saved memory about ${QUERY}`);

  const convId = db.prepare("INSERT INTO chat_conversations (title) VALUES ('probe')").run().lastInsertRowid;
  db.prepare('INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(convId, 'user', JSON.stringify([{ type: 'text', text: `chat message about ${QUERY}` }]));

  db.prepare("INSERT INTO check_ins (kind, date, payload, coach_summary) VALUES ('morning', '2026-07-01', '{}', ?)")
    .run(`check-in summary about ${QUERY}`);

  const moduleId = db.prepare("INSERT INTO modules (name, label) VALUES ('probe_module', 'Probe Module')").run().lastInsertRowid;
  db.prepare('INSERT INTO module_items (module_id, data) VALUES (?, ?)')
    .run(moduleId, JSON.stringify({ title: `module item about ${QUERY}` }));

  ({ registerTools } = await import('../mcp/src/tools.js'));
  ({ runTool } = await import('../mcp/src/tools-anthropic.js'));
  ({ simplifiedToolServer } = await import('../server/src/lib/simplified-chat-tools.js'));
});

after(() => {
  if (server) server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function textOf(result) {
  return result?.content?.[0]?.text || '';
}

describe('simplified Coach recall boundary', () => {
  it('1. simplified API recall invocation cannot surface module results', async () => {
    const result = await runTool('recall', { query: QUERY }, { simplified: true });
    const text = textOf(result);
    assert.doesNotMatch(text, /module item about/, 'simplified API recall must not surface module data');
    assert.doesNotMatch(text, /module ·/, 'simplified API recall must not tag a module source');
    assert.match(text, /saved memory about/, 'simplified API recall must still surface saved memories');
    assert.match(text, /chat message about/, 'simplified API recall must still surface conversations');
    assert.match(text, /check-in summary about/, 'simplified API recall must still surface check-ins');
  });

  it('2. simplified SDK recall handler cannot surface module results', async () => {
    const registrations = [];
    const target = { registerTool: (name, config, handler) => registrations.push({ name, config, handler }) };
    registerTools(simplifiedToolServer(target), { simplified: true });
    const recall = registrations.find((t) => t.name === 'recall');
    assert.ok(recall, 'simplified SDK registry must still expose recall');
    const result = await recall.handler({ query: QUERY });
    const text = textOf(result);
    assert.doesNotMatch(text, /module item about/, 'simplified SDK recall must not surface module data');
    assert.doesNotMatch(text, /module ·/, 'simplified SDK recall must not tag a module source');
    assert.match(text, /saved memory about/, 'simplified SDK recall must still surface saved memories');
  });

  it('3. full-agent recall still includes module results/path (API + SDK)', async () => {
    const apiResult = await runTool('recall', { query: QUERY });
    assert.match(textOf(apiResult), /module item about/, 'full API recall must still surface module data');

    const registrations = [];
    const target = { registerTool: (name, config, handler) => registrations.push({ name, config, handler }) };
    registerTools(target);
    const recall = registrations.find((t) => t.name === 'recall');
    const sdkResult = await recall.handler({ query: QUERY });
    assert.match(textOf(sdkResult), /module item about/, 'full SDK recall must still surface module data');
  });
});
