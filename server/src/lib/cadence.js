// Cadence due semantics — the SERVER's answer to "is this check-in due yet?".
//
// This has to live here, not in the browser. `cadence_pending` is read by the
// API, the MCP tools and the Telegram channel; if the due rule only exists in
// the Today view, every other caller believes midday is pending from midnight
// and nags the user about a plan they haven't made yet. The UI hiding a card is
// not the same as the system knowing it isn't due.
//
// Pure: `now` is injected, nothing is read from the DB. Callers pass the rows.

const DEFAULT_MIDDAY = '13:00';

// Strict 24h HH:MM. Deliberately NOT /^\d{2}:\d{2}$/ — that shape happily
// accepts "99:99", which then parses to a due time that never arrives.
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHHMM(v) {
  return typeof v === 'string' && HHMM.test(v);
}

// "HH:MM" → minutes since midnight; null when absent or not a real time.
export function parseHHMM(v) {
  if (!isValidHHMM(v)) return null;
  const [h, m] = v.split(':');
  return Number(h) * 60 + Number(m);
}

function minutesOf(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Is the Midday Recalibration pending right now?
 *
 * True only when ALL of these hold:
 *   • the cadence is enabled,
 *   • it hasn't already been done today,
 *   • the local wall clock is at/after midday_time,
 *   • and there is a morning to recalibrate against — today's command meeting
 *     exists, or the morning cadence is switched off (nothing to wait for).
 *
 * @param {object}  opts
 * @param {object}  opts.settings        coach_settings row
 * @param {object}  [opts.middayCheckIn] today's midday check-in, if saved
 * @param {object}  [opts.morningCheckIn] today's morning check-in, if saved
 * @param {Date}    [opts.now]
 * @returns {boolean}
 */
export function middayPending({ settings = {}, middayCheckIn = null, morningCheckIn = null, now = new Date() } = {}) {
  if (!settings.midday_enabled) return false;
  if (middayCheckIn) return false;

  // A malformed time must fall back to the default, never make the card
  // unreachable (or, worse, due at 00:00).
  const dueAt = parseHHMM(settings.midday_time) ?? parseHHMM(DEFAULT_MIDDAY);
  if (minutesOf(now) < dueAt) return false;

  return !!morningCheckIn || !settings.morning_enabled;
}
