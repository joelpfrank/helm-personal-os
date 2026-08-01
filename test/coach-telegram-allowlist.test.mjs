// Regression test: server/src/lib/channel-telegram.js used to fail OPEN —
// with HELM_COACH_BOT_TOKEN set but HELM_COACH_ALLOWED_USER_ID empty, the old
// `if (ALLOWED.length && !ALLOWED.includes(fromId))` guard skipped the check
// entirely (ALLOWED.length === 0 is falsy) and let ANY Telegram user talk to
// the coach. The allowlist must be mandatory: a bot token with no allowlist
// must refuse to start at all, and per-message handling must fail closed too.
//
// No real Telegram/network calls: fetch is mocked in-process (never hits the
// network), and the "does it actually start the long-poll loop" checks run
// in a short-lived child process with a hard kill timeout — the pre-fix
// behavior starts an infinite retry loop with un-refed timers that would
// otherwise hang this test file forever.

import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const MODULE_PATH = path.join(ROOT, 'server/src/lib/channel-telegram.js');
const MODULE_URL = new URL(`file://${MODULE_PATH}`).href;
const ORIGINAL_DB_PATH = process.env.DASHBOARD_DB_PATH;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-telegram-allowlist-'));
process.env.DASHBOARD_DB_PATH = path.join(TMP_DIR, 'test.db');

after(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DASHBOARD_DB_PATH;
  else process.env.DASHBOARD_DB_PATH = ORIGINAL_DB_PATH;
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

let seq = 0;
async function freshImport() {
  seq += 1;
  return import(`${MODULE_URL}?case=${seq}`);
}

// Imports the module fresh in a disposable child process and reports how
// many times fetch was called ~300ms after startTelegramCoach(). Forcibly
// exits the child afterward so a wrongly-started long-poll loop can never
// keep the process (or this test run) alive.
function startsNetworkLoop(env) {
  const script = `
    globalThis.fetch = async () => { globalThis.__calls = (globalThis.__calls || 0) + 1; throw new Error('no network in tests'); };
    globalThis.__calls = 0;
    const { startTelegramCoach } = await import(${JSON.stringify(MODULE_URL)});
    startTelegramCoach();
    await new Promise((r) => setTimeout(r, 300));
    process.stdout.write('RESULT:' + JSON.stringify({ calls: globalThis.__calls }) + '\\n');
    process.exit(0);
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ...env },
    timeout: 5000,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
  });
  if (res.error) throw res.error;
  const m = /RESULT:(.*)/.exec(res.stdout);
  const parsed = m ? JSON.parse(m[1]) : {};
  return { calls: parsed.calls ?? 0, stderr: res.stderr };
}

describe('Telegram coach allowlist — fail closed', () => {
  const originalToken = process.env.HELM_COACH_BOT_TOKEN;
  const originalAllowed = process.env.HELM_COACH_ALLOWED_USER_ID;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.HELM_COACH_BOT_TOKEN;
    else process.env.HELM_COACH_BOT_TOKEN = originalToken;
    if (originalAllowed === undefined) delete process.env.HELM_COACH_ALLOWED_USER_ID;
    else process.env.HELM_COACH_ALLOWED_USER_ID = originalAllowed;
  });

  it('refuses to start when a bot token is set but the allowlist is empty', () => {
    const { calls, stderr } = startsNetworkLoop({
      HELM_COACH_BOT_TOKEN: 'fake-token-for-test',
      HELM_COACH_ALLOWED_USER_ID: '',
    });
    assert.equal(calls, 0, 'a token with no allowlist must never call the Telegram API');
    assert.match(stderr, /HELM_COACH_ALLOWED_USER_ID/, 'must explain why it refused to start');
  });

  it('blank/whitespace-only allowlist also counts as empty (fails closed)', () => {
    const { calls } = startsNetworkLoop({
      HELM_COACH_BOT_TOKEN: 'fake-token-for-test',
      HELM_COACH_ALLOWED_USER_ID: '   ',
    });
    assert.equal(calls, 0);
  });

  it('a configured allowlist still starts the bot', () => {
    const { calls } = startsNetworkLoop({
      HELM_COACH_BOT_TOKEN: 'fake-token-for-test',
      HELM_COACH_ALLOWED_USER_ID: '111,222',
    });
    assert.ok(calls >= 1, 'a token with a real allowlist must still poll the Telegram API');
  });

  it('a stranger not on a configured allowlist is rejected', async () => {
    process.env.HELM_COACH_BOT_TOKEN = 'fake-token-for-test';
    process.env.HELM_COACH_ALLOWED_USER_ID = '111,222';

    const { isAllowedSender } = await freshImport();
    assert.equal(isAllowedSender('999'), false, 'a user id outside the allowlist must be rejected');
  });

  it('a configured allowlist still allows its own users through', async () => {
    process.env.HELM_COACH_BOT_TOKEN = 'fake-token-for-test';
    process.env.HELM_COACH_ALLOWED_USER_ID = '111, 222';

    const { isAllowedSender } = await freshImport();
    assert.equal(isAllowedSender('111'), true);
    assert.equal(isAllowedSender('222'), true);
  });

  it('with no allowlist configured, isAllowedSender rejects everyone (no accidental fail-open)', async () => {
    process.env.HELM_COACH_BOT_TOKEN = 'fake-token-for-test';
    delete process.env.HELM_COACH_ALLOWED_USER_ID;

    const { isAllowedSender } = await freshImport();
    assert.equal(isAllowedSender('111'), false);
    assert.equal(isAllowedSender(''), false);
  });
});
