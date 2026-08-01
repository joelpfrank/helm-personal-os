import React, { useState } from 'react';
import { useStore } from '../state/store.js';
import TagChip from './TagChip.jsx';

export default function TagInput({ value, onChange }) {
  const allTags = useStore((s) => s.tags);
  const findOrCreateTag = useStore((s) => s.findOrCreateTag);
  const [text, setText] = useState('');

  const selectedIds = new Set(value.map((t) => t.id));
  const lowerText = text.trim().toLowerCase();
  const suggestions = lowerText
    ? allTags.filter((t) => !selectedIds.has(t.id) && t.name.toLowerCase().includes(lowerText)).slice(0, 6)
    : [];

  function add(tag) {
    if (selectedIds.has(tag.id)) return;
    onChange([...value, tag]);
    setText('');
  }

  function remove(id) {
    onChange(value.filter((t) => t.id !== id));
  }

  async function commitText() {
    const name = text.trim();
    if (!name) return;
    const tag = await findOrCreateTag(name);
    if (tag) add(tag);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const exact = allTags.find((t) => t.name.toLowerCase() === lowerText);
      if (exact) add(exact);
      else commitText();
    } else if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1].id);
    }
  }

  return (
    <div className="tag-input">
      <div className="tag-input-row">
        {value.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => remove(t.id)} />
        ))}
        <input
          type="text"
          className="tag-input-text"
          value={text}
          placeholder={value.length ? '' : 'add tag…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="tag-suggestions">
          {suggestions.map((t) => (
            <button
              type="button"
              key={t.id}
              className="tag-suggestion"
              onClick={() => add(t)}
            >
              <span className="tag-suggestion-dot" style={{ background: t.color }} /> {t.name}
            </button>
          ))}
          {!suggestions.find((s) => s.name.toLowerCase() === lowerText) && lowerText && (
            <button
              type="button"
              className="tag-suggestion create"
              onClick={() => commitText()}
            >
              + create “{text.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
