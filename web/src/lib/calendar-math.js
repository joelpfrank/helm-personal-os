// Calendar grid math shared by the habits and calendar views.
//
// Week-start defaults to Monday (ISO). Pass weekStart=0 for Sunday.

function pad(n) { return String(n).padStart(2, '0'); }
export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today() { return isoDate(new Date()); }

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Date for first cell of the month-grid: e.g. if month starts on Wed,
// the grid's first cell is the Mon of that week.
export function startOfMonthGrid(year, month0, { weekStart = 1 } = {}) {
  const first = new Date(year, month0, 1);
  const dow = first.getDay(); // 0=Sun..6=Sat
  // Distance back to weekStart.
  const diff = (dow - weekStart + 7) % 7;
  return addDays(first, -diff);
}

// 42 cells (6 weeks) so every month fits without re-flowing.
export function monthGridCells(year, month0, opts = {}) {
  const start = startOfMonthGrid(year, month0, opts);
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i);
    return {
      iso: isoDate(d),
      day: d.getDate(),
      month0: d.getMonth(),
      year: d.getFullYear(),
      inMonth: d.getMonth() === month0 && d.getFullYear() === year,
      isToday: isoDate(d) === today(),
    };
  });
}

export function monthLabel(year, month0) {
  return new Date(year, month0, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Returns ['Mon','Tue',...] starting from weekStart.
const FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dowHeaders({ weekStart = 1 } = {}) {
  return Array.from({ length: 7 }, (_, i) => FULL[(weekStart + i) % 7]);
}

// Bucket a list of events by their date string (the day they begin).
export function bucketEventsByDay(events) {
  const out = {};
  for (const ev of events) {
    if (!ev.start_at) continue;
    const iso = ev.start_at.slice(0, 10);
    (out[iso] ||= []).push(ev);
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));
  }
  return out;
}
