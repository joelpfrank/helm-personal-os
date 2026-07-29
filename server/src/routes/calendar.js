import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { errors } from '../lib/errors.js';
import {
  intParam, requireString, optionalString, optionalNumber, rejectUnknownKeys,
} from '../lib/validate.js';
import {
  getCreds, getSettings, saveSettings, clearSettings,
  buildAuthUrl, exchangeCodeForTokens, fetchUserInfo,
  listCalendarList, insertEvent, patchEvent, deleteEvent,
} from '../lib/google.js';
import { syncCalendar, clearAllEvents } from '../lib/calendar-sync.js';

const router = Router();

const sql = {
  listInRange: db.prepare(`
    SELECT id, google_event_id, calendar_id, summary, description, location,
           start_at, end_at, all_day, status, html_link, recurring_event_id,
           etag, google_updated_at, color, created_at, updated_at
    FROM events
    WHERE status != 'cancelled'
      AND ((start_at >= ? AND start_at < ?) OR (end_at > ? AND end_at <= ?) OR (start_at < ? AND end_at > ?))
    ORDER BY start_at
  `),
  byId: db.prepare(`
    SELECT id, google_event_id, calendar_id, summary, description, location,
           start_at, end_at, all_day, status, html_link, recurring_event_id,
           etag, google_updated_at, color, created_at, updated_at
    FROM events WHERE id = ?
  `),
  byGoogleId: db.prepare(`
    SELECT id FROM events WHERE google_event_id = ?
  `),
};

// In-memory CSRF state nonces for OAuth round-trip. Kept tiny since
// this is a single-user app and these expire after one use.
const pendingStates = new Map();
function newState() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  // Garbage-collect stale states (>10 min old).
  for (const [k, ts] of pendingStates) {
    if (Date.now() - ts > 600_000) pendingStates.delete(k);
  }
  return state;
}
function consumeState(state) {
  const ok = pendingStates.has(state);
  pendingStates.delete(state);
  return ok;
}

// ---------- status ----------

router.get('/status', (_req, res, next) => {
  try {
    let creds = null;
    try { creds = getCreds(); } catch { creds = null; }
    const s = getSettings();
    res.json({
      configured: Boolean(creds),
      authorized: Boolean(s?.refresh_token),
      email: s?.email || null,
      calendar_id: s?.calendar_id || null,
      last_sync_at: s?.last_sync_at || null,
      last_sync_error: s?.last_sync_error || null,
      sync_from: s?.sync_from || null,
      sync_to: s?.sync_to || null,
    });
  } catch (e) { next(e); }
});

// ---------- OAuth dance ----------

router.get('/auth/start', (_req, res, next) => {
  try {
    const state = newState();
    res.redirect(buildAuthUrl(state));
  } catch (e) { next(e); }
});

router.get('/auth/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return sendAuthPage(res, 400, `Google rejected the consent: ${escapeHtml(error)}`);
    }
    if (!code || !state || !consumeState(String(state))) {
      return sendAuthPage(res, 400, 'Invalid or expired OAuth state. Try /api/calendar/auth/start again.');
    }
    const tokens = await exchangeCodeForTokens(String(code));
    if (!tokens.refresh_token) {
      return sendAuthPage(res, 400,
        'Google did not return a refresh token. This usually means a prior consent is cached — revoke at https://myaccount.google.com/permissions and re-authorize.',
      );
    }
    const nowMs = Date.now();
    saveSettings({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_expires_at: new Date(nowMs + (tokens.expires_in || 3600) * 1000).toISOString(),
      authorized_at: new Date().toISOString(),
      sync_from: new Date(nowMs - 30 * 86400_000).toISOString(),
      sync_to: new Date(nowMs + 90 * 86400_000).toISOString(),
    });

    // Fetch the user's email and pick the primary calendar.
    let email = null;
    try { email = (await fetchUserInfo())?.email || null; } catch {}
    let primary = null;
    try {
      const list = await listCalendarList();
      primary = list.find((c) => c.primary) || list[0] || null;
    } catch {}

    saveSettings({
      email,
      calendar_id: primary?.id || 'primary',
    });

    // Kick off an initial sync (don't await — return UI quickly).
    syncCalendar().catch((e) => console.error('[calendar] initial sync error', e));

    sendAuthPage(res, 200,
      `✅ Connected to ${escapeHtml(email || 'Google')}. Calendar: ${escapeHtml(primary?.summary || primary?.id || 'primary')}. Initial sync running in the background. You can close this tab.`,
    );
  } catch (e) { next(e); }
});

router.post('/disconnect', (_req, res, next) => {
  try {
    clearSettings();
    clearAllEvents();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- sync ----------

router.post('/sync', async (_req, res, next) => {
  try {
    const r = await syncCalendar();
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/sync/full', async (_req, res, next) => {
  try {
    clearAllEvents();
    const r = await syncCalendar({ force: true });
    res.json(r);
  } catch (e) { next(e); }
});

// ---------- list calendars (for picking which to use) ----------

router.get('/calendars', async (_req, res, next) => {
  try {
    const items = await listCalendarList();
    res.json(items.map((c) => ({
      id: c.id, summary: c.summary, primary: !!c.primary,
      access_role: c.accessRole, background_color: c.backgroundColor,
    })));
  } catch (e) { next(e); }
});

router.patch('/settings', async (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['calendar_id']);
    const calId = requireString(req.body, 'calendar_id');
    saveSettings({ calendar_id: calId });
    clearAllEvents(); // calendar changed → drop the mirror, full re-sync
    const r = await syncCalendar({ force: true });
    res.json({ ok: true, sync: r });
  } catch (e) { next(e); }
});

// ---------- event CRUD ----------

router.get('/events', (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : new Date(Date.now() - 30 * 86400_000).toISOString();
    const to = req.query.to ? String(req.query.to) : new Date(Date.now() + 7 * 86400_000).toISOString();
    res.json(sql.listInRange.all(from, to, from, to, from, to));
  } catch (e) { next(e); }
});

router.get('/events/:id', (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.byId.get(id);
    if (!row) throw errors.notFound('event not found');
    res.json(row);
  } catch (e) { next(e); }
});

function buildGoogleEventBody({ summary, description, location, start_at, end_at, all_day }) {
  const body = {};
  if (summary != null) body.summary = summary;
  if (description != null) body.description = description;
  if (location != null) body.location = location;
  if (start_at) {
    body.start = all_day
      ? { date: start_at.slice(0, 10) }
      : { dateTime: new Date(start_at).toISOString() };
  }
  if (end_at) {
    body.end = all_day
      ? { date: end_at.slice(0, 10) }
      : { dateTime: new Date(end_at).toISOString() };
  }
  return body;
}

router.post('/events', async (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['summary', 'description', 'location', 'start_at', 'end_at', 'all_day']);
    const s = getSettings();
    if (!s?.calendar_id) throw errors.validation('calendar not configured — visit /api/calendar/auth/start');
    const summary = requireString(req.body, 'summary');
    const description = optionalString(req.body, 'description') ?? '';
    const location = optionalString(req.body, 'location') ?? '';
    const startAt = requireString(req.body, 'start_at');
    const endAtRaw = optionalString(req.body, 'end_at');
    const allDay = req.body.all_day === true;

    // Default end_at = start_at + 1h for timed events, +1d for all-day.
    const startMs = new Date(startAt).getTime();
    if (!Number.isFinite(startMs)) throw errors.validation('start_at must be ISO 8601');
    const endAt = endAtRaw && endAtRaw.trim()
      ? endAtRaw
      : new Date(startMs + (allDay ? 86400_000 : 3600_000)).toISOString();

    const gBody = buildGoogleEventBody({
      summary, description, location, start_at: startAt, end_at: endAt, all_day: allDay,
    });
    const gEv = await insertEvent(s.calendar_id, gBody);

    // Local upsert via a sync of just this one event-shaped object.
    const { google_event_id, calendar_id } = applyOneEvent(gEv, s.calendar_id);
    const row = db.prepare('SELECT * FROM events WHERE google_event_id = ?').get(google_event_id);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch('/events/:id', async (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.byId.get(id);
    if (!row) throw errors.notFound('event not found');
    const s = getSettings();
    if (!s?.calendar_id) throw errors.validation('calendar not configured');
    rejectUnknownKeys(req.body, ['summary', 'description', 'location', 'start_at', 'end_at', 'all_day']);

    const patch = buildGoogleEventBody({
      summary: req.body.summary ?? undefined,
      description: req.body.description ?? undefined,
      location: req.body.location ?? undefined,
      start_at: req.body.start_at,
      end_at: req.body.end_at,
      all_day: req.body.all_day ?? row.all_day === 1,
    });
    const gEv = await patchEvent(row.calendar_id, row.google_event_id, patch);
    applyOneEvent(gEv, row.calendar_id);
    res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

router.delete('/events/:id', async (req, res, next) => {
  try {
    const id = intParam(req.params.id, 'id');
    const row = sql.byId.get(id);
    if (!row) throw errors.notFound('event not found');
    await deleteEvent(row.calendar_id, row.google_event_id);
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------- find_free_slot ----------

router.post('/find_free_slot', (req, res, next) => {
  try {
    rejectUnknownKeys(req.body, ['from', 'to', 'duration_minutes', 'workday_start', 'workday_end']);
    const from = requireString(req.body, 'from');
    const to = requireString(req.body, 'to');
    const dur = optionalNumber(req.body, 'duration_minutes') ?? 30;
    const wkStart = optionalString(req.body, 'workday_start') ?? '09:00';
    const wkEnd = optionalString(req.body, 'workday_end') ?? '18:00';
    const slots = findFreeSlots(from, to, dur, wkStart, wkEnd, sql);
    res.json({ duration_minutes: dur, workday_start: wkStart, workday_end: wkEnd, slots });
  } catch (e) { next(e); }
});

// ---------- shared helpers ----------

const upsertEvent = db.prepare(`
  INSERT INTO events (
    google_event_id, calendar_id, summary, description, location,
    start_at, end_at, all_day, status, html_link, recurring_event_id, etag, google_updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(google_event_id) DO UPDATE SET
    calendar_id = excluded.calendar_id,
    summary = excluded.summary,
    description = excluded.description,
    location = excluded.location,
    start_at = excluded.start_at,
    end_at = excluded.end_at,
    all_day = excluded.all_day,
    status = excluded.status,
    html_link = excluded.html_link,
    recurring_event_id = excluded.recurring_event_id,
    etag = excluded.etag,
    google_updated_at = excluded.google_updated_at
`);

function applyOneEvent(ev, calendarId) {
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const start = ev.start?.dateTime
    ? new Date(ev.start.dateTime).toISOString()
    : (ev.start?.date ? `${ev.start.date}T00:00:00.000Z` : null);
  const end = ev.end?.dateTime
    ? new Date(ev.end.dateTime).toISOString()
    : (ev.end?.date ? `${ev.end.date}T00:00:00.000Z` : start);
  if (!start) return { google_event_id: ev.id, calendar_id: calendarId };
  upsertEvent.run(
    ev.id, calendarId, ev.summary || '', ev.description || '', ev.location || '',
    start, end, allDay ? 1 : 0, ev.status || 'confirmed',
    ev.htmlLink || null, ev.recurringEventId || null, ev.etag || null, ev.updated || null,
  );
  return { google_event_id: ev.id, calendar_id: calendarId };
}

function findFreeSlots(fromIso, toIso, durationMin, wkStart, wkEnd, sql) {
  // Get events overlapping [from, to].
  const events = sql.listInRange.all(fromIso, toIso, fromIso, toIso, fromIso, toIso);
  const busy = events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => [new Date(e.start_at).getTime(), new Date(e.end_at).getTime()])
    .sort((a, b) => a[0] - b[0]);

  // Merge overlapping busy intervals.
  const merged = [];
  for (const [s, e] of busy) {
    if (!merged.length || s > merged[merged.length - 1][1]) merged.push([s, e]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
  }

  const [whS, whE] = [parseHHMM(wkStart), parseHHMM(wkEnd)];
  const out = [];
  const from = new Date(fromIso);
  const to = new Date(toIso);
  // For each day, candidate window = [workday_start..workday_end] ∩ [from..to].
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const dayStart = new Date(d); dayStart.setHours(Math.floor(whS / 60), whS % 60, 0, 0);
    const dayEnd = new Date(d); dayEnd.setHours(Math.floor(whE / 60), whE % 60, 0, 0);
    const winStart = Math.max(dayStart.getTime(), from.getTime());
    const winEnd = Math.min(dayEnd.getTime(), to.getTime());
    if (winEnd - winStart < durationMin * 60_000) continue;

    // Subtract busy intervals.
    let cursor = winStart;
    for (const [bS, bE] of merged) {
      if (bE <= cursor) continue;
      if (bS >= winEnd) break;
      if (bS - cursor >= durationMin * 60_000) {
        out.push({ start: new Date(cursor).toISOString(), end: new Date(bS).toISOString() });
      }
      cursor = Math.max(cursor, bE);
    }
    if (winEnd - cursor >= durationMin * 60_000) {
      out.push({ start: new Date(cursor).toISOString(), end: new Date(winEnd).toISOString() });
    }
  }
  return out.slice(0, 20);
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) return 9 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// This page is served unauthenticated (Google redirects the browser here
// directly, so it can't carry our bearer token — see auth.js SKIP_PREFIXES).
// Every dynamic value reaching authPage() must already be HTML-escaped by
// the caller. The CSP is belt-and-suspenders: no script is ever legitimately
// needed here, so script-src is denied outright regardless of escaping.
function authPage(msg) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Helm Calendar Auth</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #14161b; color: #e6e8ee; padding: 40px; line-height: 1.5; }
  .box { max-width: 600px; background: #1c1f26; border: 1px solid #2a2f3a; border-radius: 6px; padding: 24px; }
  code { background: #232733; padding: 2px 6px; border-radius: 3px; }
</style></head><body>
  <div class="box">
    <h2>Helm ↔ Google Calendar</h2>
    <p>${msg}</p>
  </div>
</body></html>`;
}

function sendAuthPage(res, status, msg) {
  res.status(status)
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
    .send(authPage(msg));
}

export default router;
