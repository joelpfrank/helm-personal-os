import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Quiet Instrument Coach navigation', () => {
  it('loads the lane-owned visual layer and exposes an accessible keyboard tablist', () => {
    const hub = read('web/src/views/CoachHubView.jsx');
    assert.match(hub, /import '\.\.\/styles\/coach\.css'/);
    assert.match(hub, /role="tablist"/);
    assert.match(hub, /aria-label="Coach sections"/);
    assert.match(hub, /role="tab"/);
    assert.match(hub, /aria-selected=\{tab === id\}/);
    assert.match(hub, /tabIndex=\{tab === id \? 0 : -1\}/);
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      assert.match(hub, new RegExp(key));
    }
  });
});

describe('Today monitor hierarchy', () => {
  it('renders one focal now surface before stored evidence and secondary rhythm', () => {
    const today = read('web/src/views/TodayView.jsx');
    assert.match(today, /className="today-now"/);
    assert.match(today, /className="[^"]*today-now-action/);
    assert.match(today, /className="today-rhythm"/);
    assert.match(today, /className="today-evidence"/);
    assert.match(today, />Stored in Helm</);
    assert.match(today, /const \[focalKind, \.\.\.laterKinds\] = visible/);
  });

  it('keeps quick capture explicit and keyboard-operable', () => {
    const today = read('web/src/views/TodayView.jsx');
    assert.match(today, /<label[^>]*htmlFor="today-quick-capture"/s);
    assert.match(today, /id="today-quick-capture"/);
    assert.match(today, /Enter to send · Shift\+Enter for a new line/);
  });
});

describe('Coach command and evidence boundary', () => {
  it('labels backend readiness and distinguishes interpretation from persisted evidence', () => {
    const chat = read('web/src/views/ChatView.jsx');
    assert.match(chat, /className={`coach-readiness/);
    assert.match(chat, /Model interpretation/);
    assert.match(chat, /Tool activity below is the evidence of requested reads and writes/);
    assert.match(chat, /aria-live="polite"/);
  });
});

describe('Vision, goals, and check-in inspection', () => {
  it('uses an editorial vision lead with progressively editable details', () => {
    const vision = read('web/src/components/coach/VisionPanel.jsx');
    assert.match(vision, /className="vision-lead"/);
    assert.match(vision, /className="vision-review"/);
    assert.match(vision, /aria-expanded=\{editing\}/);
    assert.match(vision, /aria-live="polite"/);
  });

  it('presents goals as an inspectable hierarchy with labelled controls', () => {
    const goals = read('web/src/components/coach/GoalsTree.jsx');
    assert.match(goals, /className="goals-intro"/);
    assert.match(goals, /aria-expanded=\{expanded\}/);
    assert.match(goals, /aria-label={`Edit goal:/);
    assert.match(goals, /className="goal-path"/);
  });

  it('uses progressive disclosure for stored check-in records without decorative accent rails', () => {
    const checkins = read('web/src/components/coach/CheckInHistory.jsx');
    assert.match(checkins, /<details[^>]*className="checkin-card"/s);
    assert.match(checkins, />Stored record</);
    assert.doesNotMatch(checkins, /borderLeftColor/);
    assert.doesNotMatch(checkins, /KIND_COLOR/);
  });
});

describe('Coach responsive and motion contract', () => {
  it('contains every owned surface, preserves compact targets, and honors reduced motion', () => {
    const css = read('web/src/styles/coach.css');
    for (const selector of [
      '.coach-hub', '.today-layout', '.today-now', '.coach-readiness',
      '.vision-lead', '.goals-intro', '.checkin-card',
    ]) assert.match(css, new RegExp(selector.replace('.', '\\.')));
    assert.match(css, /@media\s*\(max-width:\s*720px\)/);
    assert.match(css, /\.coach-tab[\s\S]*min-height:\s*44px/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.doesNotMatch(css, /linear-gradient|radial-gradient|backdrop-filter/);
  });
});
