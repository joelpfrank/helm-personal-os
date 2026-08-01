// Rate limiting for the Helm HTTP API.
//
// Helm is a local-first, single-user service. These limits are not a
// multi-tenant traffic policy — they are a safety net so a buggy client or a
// hostile process on the box can't wedge the event loop or hammer SQLite
// (CodeQL js/missing-rate-limiting, CWE-307/400/770).
//
// IMPORTANT: the app keeps Express `trust proxy` OFF, so `req.ip` is the real
// socket peer and forwarded headers (X-Forwarded-For) are ignored. A caller
// therefore cannot forge a fresh bucket by spoofing an IP header.
//
// Limits are configurable via env so operators (and tests) can tune them
// without a code change. Values are read when the limiter is created, i.e. at
// createApp() time.
import { rateLimit } from 'express-rate-limit';

const MINUTE = 60 * 1000;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const SHARED = {
  standardHeaders: 'draft-7', // emit RateLimit / RateLimit-Policy headers
  legacyHeaders: false,
};

// Global limiter: broad, generous budget applied to every request before it
// reaches a route handler (which is what CodeQL wants covered).
export function createApiLimiter() {
  return rateLimit({
    ...SHARED,
    windowMs: positiveInt(process.env.HELM_RATE_WINDOW_MS, MINUTE),
    limit: positiveInt(process.env.HELM_RATE_MAX, 600),
    message: { error: { code: 'rate_limited', message: 'too many requests — slow down' } },
  });
}

// Auth limiter: a tighter, longer-window budget layered on top of the global
// one for the first-run setup + login endpoints, to slow credential guessing.
export function createAuthLimiter() {
  return rateLimit({
    ...SHARED,
    windowMs: positiveInt(process.env.HELM_AUTH_RATE_WINDOW_MS, 15 * MINUTE),
    limit: positiveInt(process.env.HELM_AUTH_RATE_MAX, 30),
    message: { error: { code: 'rate_limited', message: 'too many attempts — wait a few minutes' } },
  });
}
