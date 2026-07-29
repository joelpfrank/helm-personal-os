import React, { useRef, useState } from 'react';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import Column from './Column.jsx';
import Card from './Card.jsx';
import { useStore } from '../state/store.js';

function midpoint(prev, next) {
  if (!prev && !next) return 1000;
  if (!prev) return next.position - 1000;
  if (!next) return prev.position + 1000;
  return (prev.position + next.position) / 2;
}

export default function Board({ board, onCardClick }) {
  const moveCard = useStore((s) => s.moveCard);
  const moveColumn = useStore((s) => s.moveColumn);
  const createColumn = useStore((s) => s.createColumn);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [draftColumn, setDraftColumn] = useState('');
  const colInputRef = useRef(null);

  async function commitColumn({ keepOpen }) {
    const name = draftColumn.trim();
    if (!name) { setAddingColumn(false); return; }
    setDraftColumn('');
    await createColumn(board.id, name);
    if (!keepOpen) setAddingColumn(false);
    if (keepOpen) setTimeout(() => colInputRef.current?.focus(), 0);
  }

  if (!board) return null;
  const columnIds = board.columns.map((c) => `col-${c.id}`);

  function findCard(id) {
    for (const col of board.columns) {
      const card = col.cards.find((c) => `card-${c.id}` === id);
      if (card) return { card, col };
    }
    return null;
  }
  function findColumn(id) {
    return board.columns.find((c) => `col-${c.id}` === id);
  }

  function onDragStart(e) { setActiveId(String(e.active.id)); }

  function onDragEnd(e) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // column reorder
    if (activeId.startsWith('col-') && overId.startsWith('col-')) {
      const oldIdx = columnIds.indexOf(activeId);
      const newIdx = columnIds.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1) return;
      const cols = board.columns;
      const target = cols[newIdx];
      const sibling = oldIdx < newIdx ? cols[newIdx + 1] : cols[newIdx - 1];
      const [prev, next] = oldIdx < newIdx ? [target, sibling] : [sibling, target];
      const colId = Number(activeId.replace('col-', ''));
      moveColumn(colId, midpoint(prev, next));
      return;
    }

    // card moves
    if (activeId.startsWith('card-')) {
      const found = findCard(activeId);
      if (!found) return;
      const cardId = found.card.id;

      if (overId.startsWith('col-')) {
        const targetCol = findColumn(overId);
        if (!targetCol) return;
        const last = targetCol.cards[targetCol.cards.length - 1];
        moveCard(cardId, targetCol.id, last ? last.position + 1000 : 1000);
        return;
      }

      if (overId.startsWith('card-')) {
        const overFound = findCard(overId);
        if (!overFound) return;
        const targetCol = overFound.col;
        const idxInTarget = targetCol.cards.findIndex((c) => c.id === overFound.card.id);
        const sameCol = targetCol.id === found.col.id;
        const cards = targetCol.cards;
        let prev, next;
        if (sameCol) {
          const oldIdx = cards.findIndex((c) => c.id === cardId);
          if (oldIdx === idxInTarget) return;
          if (oldIdx < idxInTarget) {
            prev = cards[idxInTarget];
            next = cards[idxInTarget + 1];
          } else {
            prev = cards[idxInTarget - 1];
            next = cards[idxInTarget];
          }
        } else {
          prev = cards[idxInTarget - 1];
          next = cards[idxInTarget];
        }
        moveCard(cardId, targetCol.id, midpoint(prev, next));
      }
    }
  }

  let overlay = null;
  if (activeId?.startsWith('card-')) {
    const f = findCard(activeId);
    if (f) overlay = <Card card={f.card} />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
        <div className="board">
          {board.columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              onCardClick={onCardClick}
            />
          ))}
          {addingColumn ? (
            <div className="column-add-composer">
              <input
                ref={colInputRef}
                type="text"
                autoFocus
                value={draftColumn}
                onChange={(e) => setDraftColumn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitColumn({ keepOpen: true }); }
                  if (e.key === 'Escape') { e.preventDefault(); setDraftColumn(''); setAddingColumn(false); }
                }}
                onBlur={() => commitColumn({ keepOpen: false })}
                placeholder="Column title…"
              />
              <div className="column-composer-actions">
                <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={() => commitColumn({ keepOpen: true })}>
                  Add column
                </button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraftColumn(''); setAddingColumn(false); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="column-add-col" onClick={() => { setDraftColumn(''); setAddingColumn(true); }}>
              + add column
            </button>
          )}
        </div>
      </SortableContext>
      <DragOverlay>{overlay}</DragOverlay>
    </DndContext>
  );
}
