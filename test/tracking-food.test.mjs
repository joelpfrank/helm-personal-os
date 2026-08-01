import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Quiet Instrument Food surface', () => {
  it('leads with today evidence and a provider-independent logging action', () => {
    const view = read('web/src/views/FoodView.jsx');
    assert.match(view, /className="tracking-page-heading">Food/);
    assert.match(view, /Today’s food evidence/);
    assert.doesNotMatch(view, /Claude will fill this in/);
    assert.match(view, /Log a meal below/);
  });

  it('gives navigation and macro progress explicit accessible semantics', () => {
    const view = read('web/src/views/FoodView.jsx');
    const bars = read('web/src/components/food/MacroBars.jsx');
    const tabs = read('web/src/components/tracking/TrackingTabs.jsx');
    assert.match(view, /<TrackingTabs/);
    assert.match(view, /role="tabpanel"/);
    assert.match(tabs, /aria-selected=\{active\}/);
    assert.match(tabs, /aria-controls=\{`\$\{idPrefix\}-panel-\$\{tab\.id\}`\}/);
    assert.match(bars, /role=\{range \? 'progressbar' : 'status'\}/);
    assert.match(bars, /\{\.\.\.macroProgress\}/);
  });

  it('labels manual meal fields and discloses estimation without false certainty', () => {
    const composer = read('web/src/components/food/MealComposer.jsx');
    const header = read('web/src/components/food/DayHeader.jsx');
    assert.match(composer, /aria-label="Meal description"/);
    assert.match(composer, /aria-label="Calories"/);
    assert.match(composer, /Nutrition values are optional estimates/);
    assert.match(header, /Food log score/);
    assert.match(header, /estimate/);
    assert.doesNotMatch(header, /label = 'great'/);
    assert.doesNotMatch(header, /label = 'poor'/);
  });

  it('stretches macro evidence across the compact content width', () => {
    const css = read('web/src/styles/tracking.css');
    assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.tracking-food \.macro-bars\s*\{[^}]*width:\s*100%/);
  });
});
