import React, { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Card from './Card.jsx';
import { useStore } from '../state/store.js';

export default function Column({ column, onCardClick }) {
  const renameColumn = useStore((s) => s.renameColumn);
  const deleteColumn = useStore((s) => s.deleteColumn);
  const clearColumn = useStore((s) => s.clearColumn);
  const createCard = useStore((s) => s.createCard);

  const [menuOpen, setMenuOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draftCard, setDraftCard] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(column.name);
  const menuRef = useRef(null);
  const composerRef = useRef(null);

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: `col-${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (!menuOpen) return;
    function onDocDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [menuOpen]);

  // ---- inline rename (replaces window.prompt) ----
  function startRename() {
    setMenuOpen(false);
    setDraftName(column.name);
    setRenaming(true);
  }
  async function commitRename() {
    const next = draftName.trim();
    setRenaming(false);
    if (!next || next === column.name) { setDraftName(column.name); return; }
    await renameColumn(column.id, next);
  }
  function cancelRename() {
    setDraftName(column.name);
    setRenaming(false);
  }

  async function handleDelete() {
    setMenuOpen(false);
    const cardCount = column.cards?.length ?? 0;
    const msg = cardCount > 0
      ? `delete column “${column.name}” and its ${cardCount} cards?`
      : `delete column “${column.name}”?`;
    if (!window.confirm(msg)) return;
    await deleteColumn(column.id);
  }

  async function handleClear() {
    setMenuOpen(false);
    const cardCount = column.cards?.length ?? 0;
    if (cardCount === 0) return;
    if (!window.confirm(`clear all ${cardCount} cards from “${column.name}”? (the column itself stays)`)) return;
    await clearColumn(column.id);
  }

  // ---- inline card composer ----
  function openComposer() {
    setDraftCard('');
    setComposing(true);
  }
  async function saveDraft({ keepOpen }) {
    const title = draftCard.trim();
    if (!title) {
      // Empty → dismiss without saving.
      setComposing(false);
      return;
    }
    setDraftCard('');
    await createCard(column.id, { title });
    if (!keepOpen) setComposing(false);
    // re-focus the textarea so the user can stream-add cards.
    if (keepOpen) setTimeout(() => composerRef.current?.focus(), 0);
  }
  function onComposerKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveDraft({ keepOpen: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraftCard('');
      setComposing(false);
    }
  }
  function onComposerBlur() {
    // Blur with text → save and close; blur empty → close silently.
    saveDraft({ keepOpen: false });
  }

  const cardIds = (column.cards || []).map((c) => `card-${c.id}`);

  return (
    <div ref={setNodeRef} style={style} className="column" {...attributes}>
      <div className="column-header">
        {renaming ? (
          <input
            type="text"
            autoFocus
            className="column-rename-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            }}
          />
        ) : (
          <span className="column-grab" {...listeners} title="drag to reorder">
            <span className="column-name">{column.name}</span>
            <span className="column-count">{column.cards?.length ?? 0}</span>
          </span>
        )}
        <span className="column-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="column-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="column menu"
          >⋮</button>
          {menuOpen && (
            <div className="column-menu">
              <button type="button" onClick={startRename}>rename</button>
              <button type="button" className="danger" onClick={handleClear}>clear cards</button>
              <button type="button" className="danger" onClick={handleDelete}>delete column</button>
            </div>
          )}
        </span>
      </div>
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="column-cards">
          {(column.cards || []).map((c) => (
            <Card key={c.id} card={c} onClick={() => onCardClick?.(c)} />
          ))}
          {(!column.cards || column.cards.length === 0) && !composing && (
            <div className="column-empty">drop a card here, or hit + below</div>
          )}
        </div>
      </SortableContext>
      {composing ? (
        <div className="column-composer">
          <textarea
            ref={composerRef}
            autoFocus
            value={draftCard}
            onChange={(e) => setDraftCard(e.target.value)}
            onKeyDown={onComposerKeyDown}
            onBlur={onComposerBlur}
            placeholder="Enter a title…"
            rows={2}
          />
          <div className="column-composer-actions">
            <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={() => saveDraft({ keepOpen: true })}>
              Add
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraftCard(''); setComposing(false); }}>
              Cancel
            </button>
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              Enter ⏎ to save · Shift+Enter newline · Esc to close
            </span>
          </div>
        </div>
      ) : (
        <button type="button" className="column-add" onClick={openComposer}>
          + add a card
        </button>
      )}
    </div>
  );
}
