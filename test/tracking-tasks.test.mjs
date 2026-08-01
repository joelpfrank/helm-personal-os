import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Quiet Instrument Tasks surface', () => {
  it('presents board identity and capture as the leading actions', () => {
    const view = read('web/src/views/TasksView.jsx');
    assert.match(view, /className="tracking-page-heading"/);
    assert.match(view, /className="tracking-primary-action primary"/);
    assert.match(view, /New board/);
    assert.match(view, /aria-live="polite"/);
  });

  it('makes task cards keyboard inspectable and movable between adjacent lanes', () => {
    const board = read('web/src/components/Board.jsx');
    const column = read('web/src/components/Column.jsx');
    const card = read('web/src/components/Card.jsx');
    assert.match(board, /moveCardToAdjacentColumn/);
    assert.match(column, /onMoveCard=\{onMoveCard\}/);
    assert.match(card, /e\.altKey/);
    assert.match(card, /ArrowLeft/);
    assert.match(card, /ArrowRight/);
    assert.match(card, /role="button"/);
    assert.match(card, /tabIndex=\{0\}/);
  });

  it('uses contained board scrolling and hierarchy without accent rails', () => {
    const css = read('web/src/styles/tracking.css');
    const card = read('web/src/components/Card.jsx');
    assert.match(css, /\.tracking-tasks[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.tracking-board-scroll[\s\S]*overflow-x:\s*auto/);
    assert.match(css, /\.task-color-mark/);
    assert.doesNotMatch(card, /borderLeft/);
  });
});
