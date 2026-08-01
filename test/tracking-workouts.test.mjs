import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Quiet Instrument Workouts surface', () => {
  it('leads with the current session and keeps secondary libraries in tabs', () => {
    const view = read('web/src/views/WorkoutsView.jsx');
    const tabs = read('web/src/components/tracking/TrackingTabs.jsx');
    assert.match(view, /className="tracking-page-heading">Workouts/);
    assert.match(view, /Session in progress/);
    assert.match(view, /<TrackingTabs/);
    assert.match(view, /role="tabpanel"/);
    assert.match(tabs, /onKeyDown=\{\(event\) => handleKeyDown\(event, index\)\}/);
  });

  it('shows active set progress beside elapsed time and timer controls', () => {
    const active = read('web/src/components/workouts/ActiveWorkout.jsx');
    assert.match(active, /completedSetCount/);
    assert.match(active, /totalSetCount/);
    assert.match(active, /className="active-progress"/);
    assert.match(active, /aria-live="polite"/);
    assert.match(active, /aria-label="Rest timer"/);
  });

  it('makes set completion a labelled, reversible pressed state', () => {
    const row = read('web/src/components/workouts/SetRow.jsx');
    assert.match(row, /aria-pressed=\{completed\}/);
    assert.match(row, /aria-label=\{completed \? 'Mark set incomplete' : 'Mark set complete'\}/);
    assert.match(row, /className={`set-check\$\{completed \? ' on' : ''\}`}/);
  });

  it('keeps active-session controls dense and compact targets reachable', () => {
    const css = read('web/src/styles/tracking.css');
    assert.match(css, /\.tracking-workouts \.active-workout/);
    assert.match(css, /\.tracking-workouts \.set-check[\s\S]*min-width:\s*44px/);
    assert.match(css, /\.tracking-workouts \.workouts-body[\s\S]*overflow-y:\s*auto/);
  });
});
