// Regression test: Calendar must be hidden from Helm's primary Library
// navigation, while CalendarView, state, routes, and backend stay intact
// for possible later restoration.

import { describe, it } from 'node:test';
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
