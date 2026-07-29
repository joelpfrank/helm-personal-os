import express from 'express';
import { getToken } from '../auth.js';
import { hasPassword, setPassword, verifyPassword } from '../password.js';

const router = express.Router();

// Tiny in-memory brute-force guard. This is intentionally a global throttle
// for the single-user service: after MAX_ATTEMPTS bad tries, login locks for
// WINDOW_MS and then resets.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;
let fails = { count: 0, first: 0 };

function locked() {
  if (!fails.count) return false;
  if (Date.now() - fails.first > WINDOW_MS) { fails = { count: 0, first: 0 }; return false; }
  return fails.count >= MAX_ATTEMPTS;
}
function recordFail() {
  if (!fails.count || Date.now() - fails.first > WINDOW_MS) {
    fails = { count: 1, first: Date.now() };
  } else {
    fails.count += 1;
  }
}

// Has a password been set yet? Drives "create password" vs "log in".
router.get('/status', (_req, res) => {
  res.json({ hasPassword: hasPassword() });
});

// First-run: set the password. Only works while none exists, so it can't
// be used to overwrite an existing one.
router.post('/setup', (req, res) => {
  if (hasPassword()) {
    return res.status(409).json({ error: { code: 'already_set', message: 'password already set' } });
  }
  const pw = req.body?.password;
  if (typeof pw !== 'string' || pw.length < 6) {
    return res.status(400).json({ error: { code: 'invalid', message: 'password must be at least 6 characters' } });
  }
  setPassword(pw);
  res.json({ token: getToken() });
});

// Exchange the password for the API bearer token.
router.post('/login', (req, res) => {
  if (locked()) {
    return res.status(429).json({ error: { code: 'rate_limited', message: 'too many attempts — wait a few minutes' } });
  }
  if (!hasPassword()) {
    return res.status(409).json({ error: { code: 'no_password', message: 'no password set yet' } });
  }
  const pw = req.body?.password;
  if (typeof pw === 'string' && verifyPassword(pw)) {
    fails = { count: 0, first: 0 };
    return res.json({ token: getToken() });
  }
  recordFail();
  res.status(401).json({ error: { code: 'unauthorized', message: 'wrong password' } });
});

export default router;
