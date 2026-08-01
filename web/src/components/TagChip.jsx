import React from 'react';
import { pickFg } from '../lib/color.js';

export default function TagChip({ tag, onRemove }) {
  const bg = tag.color || '#888888';
  const fg = pickFg(bg);
  return (
    <span className="tag-chip" style={{ background: bg, color: fg }}>
      {tag.name}
      {onRemove && (
        <button
          className="tag-chip-x"
          style={{ color: fg }}
          onClick={onRemove}
          aria-label={`remove ${tag.name}`}
        >×</button>
      )}
    </span>
  );
}
