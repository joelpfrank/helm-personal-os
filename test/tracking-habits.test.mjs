import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Quiet Instrument Habits surface', () => {
  it('leads with today progress and a clear capture action', () => {
    const view = read('web/src/views/HabitsView.jsx');
    assert.match(view, /className="tracking-page-heading">Habits/);
    assert.match(view, /className="habit-day-progress"/);
    assert.match(view, /role=\{todayRange \? 'progressbar' : 'status'\}/);
    assert.match(view, /\{\.\.\.todayProgress\}/);
    assert.match(view, /New habit/);
  });

  it('exposes keyboard-operable tabs and tri-state outcomes with explicit semantics', () => {
    const view = read('web/src/views/HabitsView.jsx');
    const row = read('web/src/components/habits/HabitRow.jsx');
    const tabs = read('web/src/components/tracking/TrackingTabs.jsx');
    assert.match(view, /<TrackingTabs/);
    assert.match(view, /role="tabpanel"/);
    assert.match(tabs, /role="tablist"/);
    assert.match(tabs, /role="tab"/);
    assert.match(tabs, /tabIndex=\{active \? 0 : -1\}/);
    assert.match(tabs, /ArrowLeft/);
    assert.match(tabs, /ArrowRight/);
    assert.match(tabs, /Home/);
    assert.match(tabs, /End/);
    assert.match(row, /Achieved/);
    assert.match(row, /Unspecified/);
    assert.match(row, /Not achieved/);
    assert.match(row, /aria-live="polite"/);
  });

  it('opens habit detail through a dedicated semantic control', () => {
    const row = read('web/src/components/habits/HabitRow.jsx');
    const css = read('web/src/styles/tracking.css');
    assert.match(row, /className="habit-row-main habit-row-open"/);
    assert.match(row, /aria-label=\{`View details for \$\{habit\.name\}`\}/);
    assert.doesNotMatch(row, /className=\{`habit-row[^`]*`\}[\s\S]{0,120}onClick=\{onOpen\}/);
    assert.match(css, /\.tracking-habits \.habit-row-open:focus-visible/);
  });

  it('requests a bounded calendar range when keyboard navigation selects Calendar', () => {
    const calendar = read('web/src/components/habits/HabitsCalendar.jsx');
    assert.match(calendar, /const isoTo =/);
    assert.match(calendar, /fetchCalendar\(isoFrom, isoTo\)/);
  });

  it('uses quiet row hierarchy without decorative accent rails', () => {
    const row = read('web/src/components/habits/HabitRow.jsx');
    const css = read('web/src/styles/tracking.css');
    assert.doesNotMatch(row, /borderLeftColor/);
    assert.match(row, /--habit-mark/);
    assert.match(css, /\.tracking-habits \.habit-row/);
    assert.match(css, /\.habit-state-mark/);
  });
});
