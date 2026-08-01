import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// The provider registry opens the database at module load; keep that in
// disposable state rather than creating server/data in public source.
const MODULE_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-provider-errors-'));
fs.chmodSync(MODULE_STATE, 0o700);
process.env.HELM_STATE_DIR = MODULE_STATE;
process.env.DASHBOARD_DB_PATH = path.join(MODULE_STATE, 'data', 'test.db');
after(() => fs.rmSync(MODULE_STATE, { recursive: true, force: true }));

const { createProviderSettingsRouter } = await import('../server/src/routes/providers.js');
const { errorHandler } = await import('../server/src/lib/errors.js');

// Mounts the router behind Helm's REAL error handler. Other provider suites
// use a permissive stub that honors any `error.status`, which cannot catch a
// router throwing an error shape the production handler does not recognize.
async function listen() {
  const app = express();
  app.use(express.json());
  app.use('/providers', createProviderSettingsRouter());
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/providers` };
}

describe('provider settings errors reach the client intact', () => {
  it('explains that subscription profiles never accept a copied credential', async () => {
    const { server, base } = await listen();
    try {
      for (const profileId of ['anthropic:claude-code', 'openai:codex-cli']) {
        const response = await fetch(`${base}/${profileId}/credential`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ credential: 'PASTED-KEY-CANARY' }),
        });
        const body = await response.json();
        assert.equal(response.status, 400, `${profileId} must be a client error, not a server fault`);
        assert.match(body.error.message, /provider-owned sign-in flow/i);
        // A 500 "internal server error" would hide the reason the paste was
        // refused and read as a Helm bug rather than a deliberate boundary.
        assert.notEqual(body.error.code, 'internal');
        assert.doesNotMatch(JSON.stringify(body), /PASTED-KEY-CANARY/);
      }
    } finally { server.close(); }
  });

  it('reports an unknown profile as not found rather than a server fault', async () => {
    const { server, base } = await listen();
    try {
      const response = await fetch(`${base}/nope:nope/credential`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: 'x' }),
      });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'not_found');
    } finally { server.close(); }
  });

  it('rejects an invalid selection with a usable validation message', async () => {
    const { server, base } = await listen();
    try {
      const response = await fetch(`${base}/selection`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'sideways' }),
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error.code, 'validation');
      assert.match(body.error.message, /provider or no_ai/);
    } finally { server.close(); }
  });
});
