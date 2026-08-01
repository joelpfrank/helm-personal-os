// Regression test: Calendar must be hidden from Helm's primary Library
// navigation, while CalendarView, state, routes, and backend stay intact
// for possible later restoration.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ── LibraryView must NOT expose Calendar nav ───────────────────────

describe('LibraryView calendar hidden', () => {
  const src = () => read('web/src/views/LibraryView.jsx');

  it('COLLECTIONS must not contain calendar entry', () => {
    const ids = [...src().matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
    assert.equal(ids.includes('calendar'), false,
      'calendar must not be a valid collection id');
  });

  it('must not import CalendarView', () => {
    assert.equal(src().includes('CalendarView'), false,
      'LibraryView should not import CalendarView');
  });

  it('must not render <CalendarView />', () => {
    assert.equal(src().includes('<CalendarView'), false,
      'LibraryView should not render CalendarView');
  });

  it('other Life collections stay intact', () => {
    const ids = [...src().matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
    for (const id of ['tasks', 'habits', 'workouts', 'food']) {
      assert.ok(ids.includes(id), `${id} must remain a collection`);
    }
  });

  it('must still not expose agents or settings', () => {
    const ids = [...src().matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
    assert.equal(ids.includes('agents'), false);
    assert.equal(ids.includes('settings'), false);
  });
});

// ── Calendar infrastructure must be retained ───────────────────────

describe('Calendar infrastructure retained', () => {
  it('CalendarView.jsx still exists', () => {
    assert.ok(exists('web/src/views/CalendarView.jsx'),
      'CalendarView.jsx must not be deleted');
  });

  it('calendar state store still exists', () => {
    assert.ok(exists('web/src/state/calendar.js'),
      'calendar.js store must not be deleted');
  });

  it('server calendar route still exists', () => {
    assert.ok(exists('server/src/routes/calendar.js'),
      'server calendar route must not be deleted');
  });

  it('calendar components still exist', () => {
    assert.ok(exists('web/src/components/calendar/MonthGrid.jsx'));
    assert.ok(exists('web/src/components/calendar/EventForm.jsx'));
    assert.ok(exists('web/src/components/calendar/EventCard.jsx'));
  });

  it('calendar math lib still exists', () => {
    assert.ok(exists('web/src/lib/calendar-math.js'),
      'calendar-math.js must not be deleted');
  });
});

// ── README must not claim Calendar is a usable web surface ─────────
//
// Calendar sync/event infrastructure is retained and reachable through the
// API and MCP tools (asserted above), but PRIMARY_SECTIONS in nav.js — the
// actual reachable web navigation — has no calendar entry. The README must
// describe that honestly instead of listing Calendar as a local web view or
// as one of the core surfaces usable regardless of AI backend state.

describe('README Calendar claims match reachable web navigation', () => {
  let PRIMARY_SECTIONS;
  before(async () => {
    ({ PRIMARY_SECTIONS } = await import('../web/src/lib/nav.js'));
  });

  it('nav.js confirms calendar is not a reachable primary section', () => {
    assert.equal(PRIMARY_SECTIONS.includes('calendar'), false);
  });

  it('does not describe Calendar as a local event view (implies a usable web UI)', () => {
    assert.doesNotMatch(read('README.md'), /Calendar.*:\s*a local event view/i);
  });

  it('the Calendar bullet in "What is included" says it is retained via API/MCP and not surfaced in web navigation', () => {
    const s = read('README.md');
    const bullet = s.split('\n').find((l) => /^-\s*\*\*Calendar/.test(l));
    assert.ok(bullet, 'README must still document Calendar under What is included');
    assert.match(bullet, /API|MCP/i, 'must point at how Calendar is actually reachable');
    assert.match(bullet, /not (surfaced|exposed) in|hidden from|no (calendar )?tab/i,
      'must say plainly that it is not in the simplified web navigation');
  });

  it('does not list Calendar as a bare item alongside the reachable primary surfaces', () => {
    const s = read('README.md');
    assert.doesNotMatch(s, /Workouts,\s*Calendar\b/,
      'Calendar must not be listed as if it were an equally-reachable core web surface');
  });

  it('does not advertise Calendar as a day-to-day section in reachable first-run hints', () => {
    const s = read('web/src/lib/i18n.js');
    assert.doesNotMatch(s, /Food and Calendar are the day-to-day/i);
    assert.doesNotMatch(s, /Comida y Calendario son el día a día/i);
    assert.doesNotMatch(s, /food and calendar — connected/i);
    assert.doesNotMatch(s, /comida y calendario — conectados/i);
  });
});
