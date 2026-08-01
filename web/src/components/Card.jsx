import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TagChip from './TagChip.jsx';

function formatDue(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(+d)) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

// Strip the noisiest markdown so the inline preview reads as plain text.
function notesPreview(md) {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '')           // fenced code blocks
    .replace(/^#{1,6}\s+/gm, '')              // heading hashes
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // bold
    .replace(/\*([^*]+)\*/g, '$1')            // italic *
    .replace(/_([^_]+)_/g, '$1')              // italic _
    .replace(/`([^`]+)`/g, '$1')              // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links → text
    .replace(/^\s*[-*+]\s+/gm, '• ')          // bullets
    .replace(/^\s*>\s?/gm, '')                // blockquotes
    .replace(/\n{2,}/g, '\n')                 // collapse blank lines
    .trim();
}

export default function Card({ card, onClick, onMoveCard }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${card.id}`,
    data: { type: 'card', cardId: card.id, columnId: card.column_id },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    '--task-mark': card.color || 'var(--action)',
  };

  function onPointerDown(e) {
    listeners?.onPointerDown?.(e);
  }

  function handleClick(e) {
    if (isDragging) return;
    onClick?.(e);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(e);
      return;
    }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      onMoveCard?.(card, e.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  const due = formatDue(card.due_date);
  const notes = notesPreview(card.notes);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
      role="button"
      tabIndex={0}
      aria-label={`${card.title}. Open task. Alt plus left or right arrow moves between lanes.`}
      {...attributes}
    >
      <div className="card-title"><span className="task-color-mark" aria-hidden />{card.title}</div>
      {notes && <div className="card-notes-preview">{notes}</div>}
      {(card.tags?.length || due) && (
        <div className="card-meta">
          {card.tags?.map((t) => <TagChip key={t.id} tag={t} />)}
          {due && <span className="card-due">{due}</span>}
        </div>
      )}
    </div>
  );
}
