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

export default function Card({ card, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${card.id}`,
    data: { type: 'card', cardId: card.id, columnId: card.column_id },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    borderLeft: card.color ? `4px solid ${card.color}` : undefined,
  };

  function onPointerDown(e) {
    listeners?.onPointerDown?.(e);
  }

  function handleClick(e) {
    if (isDragging) return;
    onClick?.(e);
  }

  const due = formatDue(card.due_date);
  const notes = notesPreview(card.notes);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card"
      onClick={handleClick}
      onPointerDown={onPointerDown}
      {...attributes}
    >
      <div className="card-title">{card.title}</div>
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
