// Finite, safe, public provider-error taxonomy.
//
// Raw provider/SDK failures can carry anything — request bodies, header
// echoes, key material, or an arbitrary secret a caller happened to embed in
// a prompt. That means raw text can NEVER be safely pattern-redacted: a
// shape-based scrubber only catches secrets that look like known formats
// (sk-..., Bearer ..., gh_...) and silently misses everything else. So the
// rule here is not "redact then log" — it's "never log the raw text at all".
// classifyProviderError() maps a failure to one of five codes with a FIXED
// public message; describeForLog() reduces the same failure to finite,
// non-user-derived metadata (code + HTTP status) safe for server logs.

export const PROVIDER_ERROR_CODES = ['auth', 'setup', 'model', 'rate_limit', 'provider'];

// The only provider-failure text a client can ever see.
const PUBLIC_MESSAGES = {
  auth: 'Provider authentication failed or expired. Re-run /login in Claude Code on the server (sdk backend) or set a valid ANTHROPIC_API_KEY (api backend), then try again.',
  setup: 'The coach is not configured yet. Open the Coach tab for setup instructions, or see README → Coach setup.',
  model: 'The selected model is not available on this backend. Pick a different model from the picker for this conversation.',
  rate_limit: 'The provider is rate-limiting requests right now. Wait a minute and try again.',
  provider: 'The provider request failed. Try again; if it keeps failing, check the Helm server logs.',
};

function rawTextOf(err) {
  if (err == null) return '';
  const parts = [err.message];
  try { if (err.body != null) parts.push(JSON.stringify(err.body)); } catch { /* ignore */ }
  return parts.filter(Boolean).join(' ');
}

export function classifyProviderError(err) {
  const status = Number(err?.status) || 0;
  const apiType = err?.body?.error?.type || '';
  const raw = rawTextOf(err);

  let code = 'provider';
  if (/ANTHROPIC_API_KEY not configured|not configured yet/i.test(raw)) {
    code = 'setup';
  } else if (
    status === 401 || status === 403
    || apiType === 'authentication_error' || apiType === 'permission_error'
    || /invalid.{0,10}api.?key|authentication|unauthorized|oauth|credential|(token|auth|login).{0,20}expired|expired.{0,20}(token|auth)|\/login/i.test(raw)
  ) {
    code = 'auth';
  } else if (
    status === 404 || apiType === 'not_found_error'
    || (/model/i.test(raw) && /not.?found|unsupported|unavailable/i.test(raw))
  ) {
    code = 'model';
  } else if (
    status === 429 || status === 529
    || apiType === 'rate_limit_error' || apiType === 'overloaded_error'
    || /rate.?limit|too many requests|overloaded/i.test(raw)
  ) {
    code = 'rate_limit';
  }
  return { code, message: PUBLIC_MESSAGES[code] };
}

// Server-internal only: a finite, safe summary for logs. Deliberately
// carries NO provider/user-derived string content (no message, no body, no
// stack) — only the taxonomy code and, when present, the numeric HTTP
// status. Arbitrary secrets cannot be pattern-detected reliably, so the only
// safe log line is one built entirely from closed, known-shape fields.
export function describeForLog(err) {
  const { code } = classifyProviderError(err);
  const status = Number(err?.status) || null;
  return status ? `code=${code} status=${status}` : `code=${code}`;
}
