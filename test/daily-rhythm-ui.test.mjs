// TDD tests: Today cadence gating + the task-first rhythm copy/protocol.
// RED first — the pure gating helper and the rewritten copy must FAIL before
// the production changes.
//
// Gating logic lives in a pure helper so it can be tested for real (rendering
// TodayView would need a DOM). Copy/protocol invariants are source assertions
// only where they cannot be executed — prompts are data, not behavior.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// A fixed wall-clock time on a fixed day, so these tests never go flaky.
const at = (h, m = 0) => new Date(2026, 6, 16, h, m, 0);

const SETTINGS = {
  morning_enabled: 1, morning_time: '08:00',
  midday_enabled: 1, midday_time: '13:00',
  evening_enabled: 1, evening_time: '21:00',
};
const ALL_PENDING = { morning: true, midday: true, evening: true, weekly: false, vision: false };

describe('visibleCadenceCards - time gating', () => {
  let visibleCadenceCards;

  before(async () => {
    ({ visibleCadenceCards } = await import('../web/src/lib/cadence.js'));
  });

  const show = (opts) => visibleCadenceCards({ settings: SETTINGS, ...opts });

  it('shows a pending Daily Command Meeting all day — even at 23:00', () => {
    assert.ok(show({ pending: ALL_PENDING, now: at(6) }).includes('morning'));
    assert.ok(show({ pending: ALL_PENDING, now: at(23) }).includes('morning'),
      'an unfinished command meeting must never silently vanish');
  });

  it('hides the command meeting once it is done', () => {
    const pending = { ...ALL_PENDING, morning: false };
    assert.ok(!show({ pending, now: at(9) }).includes('morning'));
  });

  it('does not show midday before its configured time', () => {
    assert.ok(!show({ pending: ALL_PENDING, now: at(11), morningDone: true }).includes('midday'));
    assert.ok(!show({ pending: ALL_PENDING, now: at(12, 59), morningDone: true }).includes('midday'));
  });

  it('shows midday at its configured time once morning is done', () => {
    assert.ok(show({ pending: ALL_PENDING, now: at(13), morningDone: true }).includes('midday'));
    assert.ok(show({ pending: ALL_PENDING, now: at(15), morningDone: true }).includes('midday'));
  });

  it('does not nag with midday while the command meeting is still undone', () => {
    assert.ok(!show({ pending: ALL_PENDING, now: at(15), morningDone: false }).includes('midday'),
      'midday must not crowd in before the morning it recalibrates against');
  });

  it('shows midday after its time when the morning cadence is disabled entirely', () => {
    const settings = { ...SETTINGS, morning_enabled: 0 };
    const pending = { ...ALL_PENDING, morning: false };
    const out = visibleCadenceCards({ settings, pending, now: at(14), morningDone: false });
    assert.ok(out.includes('midday'), 'with no morning cadence, midday stands on its own');
  });

  it('honours a custom midday_time', () => {
    const settings = { ...SETTINGS, midday_time: '11:30' };
    const opts = { settings, pending: ALL_PENDING, morningDone: true };
    assert.ok(!visibleCadenceCards({ ...opts, now: at(11, 0) }).includes('midday'));
    assert.ok(visibleCadenceCards({ ...opts, now: at(11, 30) }).includes('midday'));
  });

  it('never shows a disabled or completed midday', () => {
    const settings = { ...SETTINGS, midday_enabled: 0 };
    assert.ok(!visibleCadenceCards({ settings, pending: ALL_PENDING, now: at(15), morningDone: true }).includes('midday'));
    const pending = { ...ALL_PENDING, midday: false };
    assert.ok(!visibleCadenceCards({ settings: SETTINGS, pending, now: at(15), morningDone: true }).includes('midday'));
  });

  it('keeps the evening closeout on the 17:00 gate by default', () => {
    const opts = { pending: ALL_PENDING, morningDone: true };
    assert.ok(!show({ ...opts, now: at(16, 59) }).includes('evening'));
    assert.ok(show({ ...opts, now: at(17) }).includes('evening'));
    assert.ok(show({ ...opts, now: at(22) }).includes('evening'));
  });

  it('opens the closeout earlier when the user configures an earlier evening_time', () => {
    const settings = { ...SETTINGS, evening_time: '16:00' };
    const out = visibleCadenceCards({ settings, pending: ALL_PENDING, now: at(16, 0), morningDone: true });
    assert.ok(out.includes('evening'));
  });

  it('survives midnight without dropping a pending command meeting', () => {
    // 00:30 on a fresh day: morning pending shows; midday/evening are simply
    // not due yet — they must not appear, and morning must not disappear.
    const out = show({ pending: ALL_PENDING, now: at(0, 30), morningDone: false });
    assert.deepEqual(out, ['morning']);
  });

  it('falls back to sane defaults when a time setting is missing or malformed', () => {
    const settings = { morning_enabled: 1, midday_enabled: 1, evening_enabled: 1, midday_time: 'nonsense', evening_time: null };
    const out = visibleCadenceCards({ settings, pending: ALL_PENDING, now: at(15), morningDone: true });
    assert.ok(out.includes('midday'), 'malformed midday_time must fall back to 13:00, not hide the card forever');
    assert.ok(!visibleCadenceCards({ settings, pending: ALL_PENDING, now: at(9), morningDone: true }).includes('midday'));
  });

  it('passes weekly and vision through untouched', () => {
    const pending = { morning: false, midday: false, evening: false, weekly: true, vision: true };
    const out = show({ pending, now: at(10) });
    assert.deepEqual(out, ['weekly', 'vision']);
  });

  it('returns cards in rhythm order', () => {
    const pending = { morning: true, midday: true, evening: true, weekly: true, vision: true };
    const out = show({ pending, now: at(18), morningDone: false });
    // morning still pending → midday suppressed; evening past its gate.
    assert.deepEqual(out, ['morning', 'evening', 'weekly', 'vision']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Copy invariants — Today cards. Source assertions: no DOM to drive.
// ═══════════════════════════════════════════════════════════════════

describe('Today copy - Daily Command Meeting', () => {
  it('names the morning card the Daily Command Meeting, not a briefing', () => {
    const i18n = read('web/src/lib/i18n.js');
    assert.match(i18n, /Daily Command Meeting/);
    assert.ok(!/Morning briefing/i.test(i18n), 'the old "Morning briefing" label must be gone');
  });

  it('drops the false ~30-second claim', () => {
    const i18n = read('web/src/lib/i18n.js');
    const today = read('web/src/views/TodayView.jsx');
    assert.ok(!/~?30 seconds/i.test(i18n), 'the ~30s claim was never true of a real reconciliation');
    assert.ok(!/~?30 seconds/i.test(today));
    assert.ok(!/~?30 segundos/i.test(i18n));
  });

  it('ships midday card copy in both languages', () => {
    const i18n = read('web/src/lib/i18n.js');
    assert.match(i18n, /'cad\.midday\.title'/);
    assert.match(i18n, /'cad\.midday\.body'/);
    assert.match(i18n, /'cad\.midday\.cta'/);
    // Spanish half must not be left behind.
    const es = i18n.slice(i18n.indexOf("'today.morning': 'Buenos días'"));
    assert.match(es, /'cad\.midday\.title'/);
  });

  it('renames the evening card to a closeout', () => {
    const i18n = read('web/src/lib/i18n.js');
    assert.match(i18n, /Daily Closeout/i);
  });

  it('TodayView renders cadence cards through the pure gating helper', () => {
    const today = read('web/src/views/TodayView.jsx');
    assert.match(today, /visibleCadenceCards/, 'gating must come from the tested helper, not inline hour math');
    assert.ok(!/hour\s*>=\s*17/.test(today), 'the old inline 17:00 check must be gone');
    assert.match(today, /CADENCE_OPENERS\.midday|midday/, 'TodayView must be able to open a midday session');
  });

  it('distinguishes midday check-ins semantically without a decorative color rail', () => {
    const s = read('web/src/components/coach/CheckInHistory.jsx');
    // The explicit label survives without making color the only distinction.
    assert.match(s, /midday:\s*'recalibration'/, 'KIND_LABEL must name midday by purpose');
    assert.match(s, /KIND_LABEL\[c\.kind\]/, 'stored records must render their semantic kind label');
    assert.match(s, /<option value="midday">/, 'the filter must offer midday');
    assert.doesNotMatch(s, /KIND_COLOR|borderLeftColor/,
      'check-in kinds must not restore the decorative color rail');
  });

  it('drops the stale "morning briefing" phrasing from the check-in hint', () => {
    const s = read('web/src/components/coach/CheckInHistory.jsx');
    assert.ok(!/morning briefing/i.test(s), 'the hint must teach the new rhythm');
    assert.match(s, /Daily Command Meeting/i);
  });

  it('carries no stale onboarding rhythm copy in TodayView', () => {
    const s = read('web/src/views/TodayView.jsx');
    assert.ok(!/morning briefing/i.test(s));
  });

  it('carries no dead cadence copy', () => {
    const i18n = read('web/src/lib/i18n.js');
    // cad.visionSet.* was superseded by cad.vision.bodyUnset/ctaUnset. Dead
    // keys read as live copy to the next person translating this file.
    assert.ok(!/cad\.visionSet/.test(i18n),
      'cad.visionSet.* is unused — cad.vision.bodyUnset/ctaUnset replaced it');
  });

  it('interpolates {days} through i18n rather than a manual replace', () => {
    const today = read('web/src/views/TodayView.jsx');
    assert.ok(!/\.replace\(\s*'\{days\}'/.test(today),
      'translate() already interpolates vars — a manual replace bypasses it and breaks any translation that moves the token');
    assert.match(today, /t\('cad\.vision\.body',\s*\{\s*days/,
      'the days count must be passed as an i18n var');
  });

  it('keeps the cadence copy at full en/es parity', () => {
    const s = read('web/src/lib/i18n.js');
    const en = s.slice(s.indexOf('  en: {'), s.indexOf('  es: {'));
    const es = s.slice(s.indexOf('  es: {'));
    const cadKeys = (block) => [...block.matchAll(/'(cad\.[\w.]+)':/g)].map((m) => m[1]).sort();
    // A key present in en but missing in es silently renders English to a
    // Spanish user — the fallback hides the omission instead of failing.
    assert.deepEqual(cadKeys(es), cadKeys(en), 'every cadence key must exist in both languages');
  });

  it('gives the midday card its own accent, like every other cadence card', () => {
    const css = read('web/src/styles.css');
    assert.match(css, /\.today-cadence-card\.kind-midday\s*\{[^}]*border-left-color/,
      'without its own rule the midday card silently inherits the generic accent');
  });

  it('groups the cadence cards semantically for screen readers', () => {
    const today = read('web/src/views/TodayView.jsx');
    // A bare <div> stack announces as nothing: a screen-reader user hears the
    // card copy with no idea it is a group of pending check-ins, and the card
    // titles are not reachable as headings.
    assert.match(today, /<aside className="today-rhythm"\s+aria-labelledby="today-rhythm-heading">/,
      'the labeled day-rhythm aside must expose its heading to screen readers');
    assert.match(today, /<h2 id="today-rhythm-heading">Later<\/h2>/,
      'the day-rhythm accessible name must resolve to a visible heading');
    assert.match(today, /<h[23][^>]*className="cadence-title"/,
      'each cadence card title must be a real heading, not a styled div');
  });

  it('keeps weekly and vision flows intact', () => {
    const today = read('web/src/views/TodayView.jsx');
    // The openers are dispatched by kind, so assert the flows still exist
    // rather than pinning the call syntax.
    const openers = today.slice(today.indexOf('const CADENCE_OPENERS'), today.indexOf('const ONBOARDING_OPENER'));
    for (const kind of ['morning', 'midday', 'evening', 'weekly', 'vision']) {
      assert.match(openers, new RegExp(`^\\s{2}${kind}:`, 'm'), `${kind} opener must exist`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Protocol invariants — the coach prompt must be task-first
// ═══════════════════════════════════════════════════════════════════

describe('Coach protocol - task-first invariants', () => {
  const chat = () => read('server/src/routes/chat.js');

  it('defines all three daily beats by name', () => {
    const s = chat();
    assert.match(s, /Daily Command Meeting/);
    assert.match(s, /Midday Recalibration/);
    assert.match(s, /Daily Closeout/);
  });

  it('orders the command meeting: briefing first, then task_snapshot, then talk', () => {
    const s = chat();
    const meeting = s.slice(s.indexOf('Daily Command Meeting'));
    assert.match(meeting, /get_coach_briefing/);
    assert.match(meeting, /task_snapshot/);
  });

  it('requires explicit confirmation before changing or removing tasks', () => {
    const s = chat();
    assert.match(s, /never (move|change|update|delete|remove)[^.\n]*without[^.\n]*confirm/i);
  });

  it('bans the rigid questionnaire and demands one question at a time', () => {
    const s = chat();
    assert.match(s, /one question at a time/i);
    assert.match(s, /questionnaire|rigid|same .* questions every day/i);
  });

  it('anchors priorities to real card ids rather than invented work', () => {
    const s = chat();
    assert.match(s, /must-win/i);
    assert.match(s, /card id/i);
  });

  it('names the must-win with ONE singular key everywhere', () => {
    // Exactly one must-win is allowed, so a plural `must_win_card_ids` is a
    // lie in the schema: it invites the model to log two and quietly breaks
    // the midday/closeout reconciliation that reads the singular key the
    // morning wrote. Supporting priorities stay plural — those really are many.
    for (const rel of ['server/src/routes/chat.js', 'mcp/src/tools.js']) {
      const s = read(rel);
      assert.ok(!/must_win_card_ids/.test(s),
        `${rel} must not advertise a plural must_win_card_ids — only one must-win exists`);
      assert.match(s, /must_win_card_id\b/, `${rel} must name the singular must-win key`);
      assert.match(s, /supporting_card_ids/, `${rel} keeps supporting priorities plural`);
    }
  });

  it('makes the closeout reconcile tasks before reflecting', () => {
    const s = chat();
    const closeout = s.slice(s.indexOf('Daily Closeout'));
    assert.match(closeout, /reconcile/i);
    assert.ok(/loose end/i.test(closeout), 'closeout must capture loose ends');
  });

  it('does not claim reflection alone keeps the boards current', () => {
    const s = chat();
    assert.ok(!/Evening reflection: Explore one win/i.test(s),
      'the old reflection-only evening protocol must be replaced');
  });

  it('updates the onboarding rhythm phase to the three-part rhythm', () => {
    const s = chat();
    const phase4 = s.slice(s.indexOf('PHASE 4'));
    assert.match(phase4, /Daily Command Meeting/);
    assert.match(phase4, /midday/i);
  });
});
