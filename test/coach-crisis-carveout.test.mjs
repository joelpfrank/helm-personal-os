// Regression test: COACH_INSTRUCTIONS only had a soft "you are not a
// therapist... then steer back to action" line, with nothing that overrides
// challenge/accountability behavior for acute distress. A user disclosing
// suicidal ideation or self-harm could get met with challenge-level
// accountability pressure instead of safety-first de-escalation. This test
// requires an explicit, overriding crisis carve-out in the assembled coach
// prompt, mirrored concisely in docs/COACHING.md, and a persistent
// (non-dismissible) disclaimer in the reachable Coach chat UI.
//
// Wording must stay global — no hardcoded single-country hotline (e.g. the
// US "988") as the only avenue offered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const between = (s, start, end) => s.slice(s.indexOf(start), end ? s.indexOf(end) : undefined);

describe('COACH_INSTRUCTIONS — acute-distress crisis override', () => {
  const instructions = () => between(read('server/src/routes/chat.js'), 'const COACH_INSTRUCTIONS', '\n## The daily rhythm');

  it('names the crisis triggers (suicide/self-harm/acute distress)', () => {
    assert.match(instructions(), /suicid|self-harm/i);
  });

  it('explicitly overrides/supersedes normal challenge and accountability pressure', () => {
    const s = instructions();
    assert.match(s, /overrides?|supersedes?|takes priority|stop (all )?coaching/i);
    assert.match(s, /challenge|accountability/i);
  });

  it('does not pretend to diagnose or assess risk', () => {
    assert.match(instructions(), /not qualified to diagnose|do not diagnose|not.{0,20}diagnos/i);
  });

  it('directs the user to immediate local emergency/crisis support', () => {
    const s = instructions();
    assert.match(s, /local emergency|crisis (line|helpline|service|support)/i);
  });

  it('directs the user to reach a trusted person', () => {
    assert.match(instructions(), /trusted person/i);
  });

  it('stays global — does not hardcode a single-country hotline as the only option', () => {
    assert.doesNotMatch(instructions(), /\b988\b/, 'must not hardcode the US-only 988 line as the guidance');
  });
});

describe('docs/COACHING.md — mirrors the crisis carve-out concisely', () => {
  const coaching = () => read('docs/COACHING.md');

  it('documents the crisis override in the safety boundaries', () => {
    const s = coaching();
    assert.match(s, /crisis/i);
    assert.match(s, /suicid|self-harm/i);
    assert.match(s, /trusted person|local emergency/i);
  });

  it('states the coach does not diagnose', () => {
    assert.match(coaching(), /not.{0,20}diagnos/i);
  });

  it('stays global — no hardcoded single-country hotline', () => {
    assert.doesNotMatch(coaching(), /\b988\b/);
  });
});

describe('Coach chat UI — persistent (non-dismissible) crisis disclaimer', () => {
  const source = () => read('web/src/views/ChatView.jsx');

  it('renders crisis-safety wording directly in the reachable Coach chat surface', () => {
    const s = source();
    assert.match(s, /crisis|emergency/i);
  });

  it('the disclaimer is not gated behind the dismissible FirstRunHint (must stay reachable after dismissal)', () => {
    const s = source();
    const hintMatch = /<FirstRunHint[\s\S]*?<\/FirstRunHint>/.exec(s);
    assert.ok(hintMatch, 'expected the existing FirstRunHint usage to still be present');
    const outsideHint = s.replace(hintMatch[0], '');
    assert.match(outsideHint, /crisis|emergency/i,
      'crisis/emergency wording must appear outside the dismissible FirstRunHint block');
  });
});
