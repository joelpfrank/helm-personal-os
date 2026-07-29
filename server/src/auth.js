import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.resolve(__dirname, '..', '..', '.dashboard-token');
const RUNNING_UNDER_NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT);

let cachedToken = null;
let cachedTokenBuf = null;

export function getToken() {
  if (cachedToken) return cachedToken;
  if (fs.existsSync(TOKEN_PATH)) {
    cachedToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  } else if (RUNNING_UNDER_NODE_TEST) {
    // Test workers need a real token for authenticated route coverage, but must
    // never materialize credentials in the publication candidate.
    cachedToken = crypto.randomBytes(32).toString('hex');
  } else {
    cachedToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(TOKEN_PATH, cachedToken + '\n', { mode: 0o600 });
    try { fs.chmodSync(TOKEN_PATH, 0o600); } catch {}
    console.log('[auth] generated new token at', TOKEN_PATH);
  }
  cachedTokenBuf = Buffer.from(cachedToken, 'utf8');
  return cachedToken;
}

export function tokenPath() { return TOKEN_PATH; }

// Routes that bypass bearer-token auth. /api/health is read-only and
// /api/calendar/auth/* is hit by browsers during the Google OAuth
// dance — they don't carry our Authorization header. The OAuth flow
// is gated by Google's own auth + a single-use CSRF state.
const SKIP_PREFIXES = ['/api/health', '/api/calendar/auth', '/api/auth'];

export function requireAuth(req, res, next) {
  // Static SPA assets (everything outside /api) are public; the SPA
  // itself attaches the token on its /api/* fetches.
  if (!req.path.startsWith('/api/') && req.path !== '/api') return next();
  if (SKIP_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }
  const header = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'missing bearer token' } });
  }
  const provided = Buffer.from(m[1].trim(), 'utf8');
  const expected = cachedTokenBuf || Buffer.from(getToken(), 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'invalid token' } });
  }
  return next();
}
