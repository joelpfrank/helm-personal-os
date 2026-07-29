// Pull Google Calendar events into the local `events` table using
// incremental sync via syncToken. On first sync (no token), pulls a
// window [now-30d, now+90d] and stores the nextSyncToken. On 410
// (invalid token), wipes and does a full re-sync.

import { db } from '../db.js';
import {
  getSettings, setSyncToken, setSyncError, clearSyncToken,
  saveSettings, listEvents,
} from './google.js';

const sql = {
  upsert: db.prepare(`
    INSERT INTO events (
      google_event_id, calendar_id, summary, description, location,
      start_at, end_at, all_day, status, html_link, recurring_event_id,
      etag, google_updated_at, color
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      google_updated_at = excluded.google_updated_at,
      color = excluded.color
  `),
  deleteByGoogleId: db.prepare('DELETE FROM events WHERE google_event_id = ?'),
  clearAll: db.prepare('DELETE FROM events'),
};

// Google Calendar's `colorId` palette — the 11 stock event colors the
// Calendar UI exposes. Keys are the colorIds Google returns; values are
// the hex strings Google itself renders. See
// developers.google.com/calendar/api/v3/reference/colors/get
const GOOGLE_COLORS = {
  '1':  '#7986cb', // lavender
  '2':  '#33b679', // sage
  '3':  '#8e24aa', // grape
  '4':  '#e67c73', // flamingo
  '5':  '#f6c026', // banana
  '6':  '#f5511d', // tangerine
  '7':  '#039be5', // peacock
  '8':  '#616161', // graphite
  '9':  '#3f51b5', // blueberry
  '10': '#0b8043', // basil
  '11': '#d60000', // tomato
};

function extractISO(maybe) {
  if (!maybe) return null;
  // Google returns either { dateTime, timeZone } or { date } (all-day).
  if (maybe.dateTime) return new Date(maybe.dateTime).toISOString();
  if (maybe.date) {
    // For all-day events, store midnight local-ish — keep the date.
    return `${maybe.date}T00:00:00.000Z`;
  }
  return null;
}

function isAllDay(ev) {
  return Boolean(ev.start?.date && !ev.start?.dateTime);
}

function normalize(ev, calendarId) {
  return {
    google_event_id: ev.id,
    calendar_id: calendarId,
    summary: ev.summary || '',
    description: ev.description || '',
    location: ev.location || '',
    start_at: extractISO(ev.start) || '',
    end_at: extractISO(ev.end) || extractISO(ev.start) || '',
    all_day: isAllDay(ev) ? 1 : 0,
    status: ev.status || 'confirmed',
    html_link: ev.htmlLink || null,
    recurring_event_id: ev.recurringEventId || null,
    etag: ev.etag || null,
    google_updated_at: ev.updated || null,
    color: GOOGLE_COLORS[ev.colorId] || null,
  };
}

function applyEvent(ev, calendarId) {
  if (ev.status === 'cancelled') {
    sql.deleteByGoogleId.run(ev.id);
    return;
  }
  const n = normalize(ev, calendarId);
  if (!n.start_at) return; // Skip malformed events
  sql.upsert.run(
    n.google_event_id, n.calendar_id, n.summary, n.description, n.location,
    n.start_at, n.end_at, n.all_day, n.status, n.html_link,
    n.recurring_event_id, n.etag, n.google_updated_at, n.color,
  );
}

// ---------- Sync entry ----------

export async function syncCalendar({ force = false } = {}) {
  const s = getSettings();
  if (!s || !s.refresh_token) return { skipped: 'not authorized' };
  if (!s.calendar_id) return { skipped: 'no calendar selected' };

  const calendarId = s.calendar_id;
  const useToken = !force && s.sync_token;

  let pageToken = undefined;
  let nextSyncToken = null;
  let added = 0, removed = 0;

  try {
    while (true) {
      const params = useToken
        ? { syncToken: s.sync_token, ...(pageToken && { pageToken }) }
        : {
            timeMin: s.sync_from || new Date(Date.now() - 30 * 86400_000).toISOString(),
            timeMax: s.sync_to || new Date(Date.now() + 90 * 86400_000).toISOString(),
            singleEvents: 'true',
            ...(pageToken && { pageToken }),
          };

      let page;
      try {
        page = await listEvents(calendarId, params);
      } catch (err) {
        if (err.status === 410 && useToken) {
          // syncToken expired → restart full sync
          clearSyncToken();
          sql.clearAll.run();
          return syncCalendar({ force: true });
        }
        throw err;
      }

      for (const ev of page.items || []) {
        if (ev.status === 'cancelled') removed++;
        else added++;
        applyEvent(ev, calendarId);
      }

      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        continue;
      }
      if (page.nextSyncToken) {
        nextSyncToken = page.nextSyncToken;
      }
      break;
    }

    if (nextSyncToken) setSyncToken(nextSyncToken);
    else saveSettings({ last_sync_at: new Date().toISOString(), last_sync_error: null });
    return { ok: true, added, removed, sync_token: nextSyncToken || s.sync_token };
  } catch (err) {
    setSyncError(err.message || String(err));
    throw err;
  }
}

export function clearAllEvents() {
  sql.clearAll.run();
  clearSyncToken();
}
