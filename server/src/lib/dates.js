// Date utilities shared by routes that care about "today" in the
// server's local timezone (which should match the user's wall clock).

export function todayISO(d = new Date()) {
  // YYYY-MM-DD in local time.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ISO weekday: 1=Mon … 7=Sun, matching how habits store days_of_week.
export function isoDayOfWeek(d = new Date()) {
  const dow = d.getDay();
  return dow === 0 ? 7 : dow;
}

// Parse a days_of_week CSV like "1,3,5" → [1,3,5].
export function parseDaysOfWeek(csv) {
  return String(csv || '').split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

export function isScheduledOn(habit, date = new Date()) {
  const days = parseDaysOfWeek(habit.days_of_week);
  return days.includes(isoDayOfWeek(date));
}

// Inclusive range [from, to], stepped by one day, returns YYYY-MM-DD strings.
export function dateRange(from, to) {
  const out = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(todayISO(d));
  }
  return out;
}

export function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayISO(d);
}
