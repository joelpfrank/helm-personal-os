// Which cadence cards Today should show right now.
//
// NOTE: this is presentation gating, NOT the source of truth. Whether a
// check-in is DUE is decided server-side in server/src/lib/cadence.js, so the
// API, MCP tools and Telegram all agree; `pending.midday` already arrives
// correctly gated. The re-check here exists because a briefing can go stale in
// a tab left open across the midday hour — it must never be the only gate, or
// every non-browser caller nags at 00:01.
//
// Pure on purpose: gating is the part users notice when it's wrong (a card
// that nags too early, or — worse — one that vanishes and takes the day's
// plan with it), and a pure function is the only part of this we can test
// honestly without a DOM.
//
// Principles:
//   • A pending Daily Command Meeting shows ALL DAY. If you haven't set the
//     day's direction by 4pm, that's exactly when you most need to.
//   • The Midday Recalibration waits for its configured time AND for a
//     morning to recalibrate against. Nagging at 13:00 about a plan that was
//     never made is noise.
//   • The Daily Closeout opens at 17:00, or earlier if the user configured an
//     earlier evening_time. It never opens later than 17:00, which preserves
//     the long-standing behavior of the evening card.

const DEFAULT_MIDDAY = '13:00';
const EVENING_GATE = '17:00';

// "HH:MM" → minutes since midnight; null when absent/malformed. A bad value
// must never make a card unreachable, so callers fall back to a default.
function parseMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesOf(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * @param {object}  opts
 * @param {object}  opts.pending     briefing.cadence_pending
 * @param {object}  opts.settings    briefing.coach_settings
 * @param {boolean} opts.morningDone whether today's command meeting is saved
 * @param {Date}    [opts.now]
 * @returns {string[]} cadence kinds to render, in rhythm order
 */
export function visibleCadenceCards({ pending = {}, settings = {}, morningDone = false, now = new Date() } = {}) {
  const nowMin = minutesOf(now);
  const out = [];

  // Pending all day — deliberately ungated.
  if (pending.morning) out.push('morning');

  const middayAt = parseMinutes(settings.midday_time) ?? parseMinutes(DEFAULT_MIDDAY);
  // If the morning cadence is switched off there is no meeting to wait for,
  // so midday stands on its own rather than being gated forever.
  const morningSettled = morningDone || !settings.morning_enabled;
  if (pending.midday && settings.midday_enabled && nowMin >= middayAt && morningSettled) {
    out.push('midday');
  }

  const configuredEvening = parseMinutes(settings.evening_time);
  const eveningGate = Math.min(configuredEvening ?? parseMinutes(EVENING_GATE), parseMinutes(EVENING_GATE));
  if (pending.evening && nowMin >= eveningGate) out.push('evening');

  // Weekly and vision carry their own due logic server-side; pass them through.
  if (pending.weekly) out.push('weekly');
  if (pending.vision) out.push('vision');

  return out;
}
