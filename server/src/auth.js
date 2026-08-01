import crypto from 'node:crypto';
import fs from 'node:fs';
import { dashboardTokenPath, ensureStateDir } from './lib/state-paths.js';

const RUNNING_UNDER_NODE_TEST = Boolean(process.env.NODE_TEST_CONTEXT);

let cachedToken = null;
let cachedTokenBuf = null;

export function getToken() {
  if (cachedToken) return cachedToken;
  const TOKEN_PATH = dashboardTokenPath();
  const ephemeralToken = RUNNING_UNDER_NODE_TEST ? process.env.DASHBOARD_TOKEN?.trim() : '';
  if (ephemeralToken) {
    cachedToken = ephemeralToken;
  } else if (fs.existsSync(TOKEN_PATH)) {
    cachedToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  } else if (RUNNING_UNDER_NODE_TEST) {
    // Test workers need a real token for authenticated route coverage, but must
    // never materialize credentials in the publication candidate.
    cachedToken = crypto.randomBytes(32).toString('hex');
  } else {
    cachedToken = crypto.randomBytes(32).toString('hex');
    ensureStateDir();
    fs.writeFileSync(TOKEN_PATH, cachedToken + '\n', { mode: 0o600 });
    try { fs.chmodSync(TOKEN_PATH, 0o600); } catch {}
    console.log('[auth] generated new token at', TOKEN_PATH);
  }
  cachedTokenBuf = Buffer.from(cachedToken, 'utf8');
  return cachedToken;
}

export function tokenPath() { return dashboardTokenPath(); }

// Parse an "Authorization: Bearer <token>" header without a backtracking
// regex. The old form `/^Bearer\s+(.+)$/i` was polynomial: `\s+` and `.+`
// both match spaces, so a header of many spaces forced quadratic backtracking
// (CodeQL js/polynomial-redos). This does the same job in linear time —
// require the scheme prefix, at least one whitespace separator, then trim.
export function parseBearerToken(header) {
  const s = typeof header === 'string' ? header : '';
  if (s.slice(0, 6).toLowerCase() !== 'bearer') return null;
  const rest = s.slice(6);
  if (rest === '' || rest[0].trim() !== '') return null;
  const token = rest.trim();
  return token || null;
}

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
  const token = parseBearerToken(req.get('authorization'));
  if (!token) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'missing bearer token' } });
  }
  const provided = Buffer.from(token, 'utf8');
  const expected = cachedTokenBuf || Buffer.from(getToken(), 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'invalid token' } });
  }
  return next();
}
