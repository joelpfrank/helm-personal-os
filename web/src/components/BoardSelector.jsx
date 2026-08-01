import React from 'react';

export default function BoardSelector({ boards, activeId, onSelect }) {
  return (
    <select
      className="board-selector"
      value={activeId ?? ''}
      onChange={(e) => onSelect(Number(e.target.value))}
    >
      {boards.length === 0 && <option value="">— no boards —</option>}
      {boards.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
}
