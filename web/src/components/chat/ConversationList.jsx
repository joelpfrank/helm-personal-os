import React from 'react';

function fmtRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const dt = Date.now() - t;
  const min = Math.floor(dt / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationList({ conversations, activeId, onPick, onDelete, onNew }) {
  return (
    <div className="conv-list">
      <button type="button" className="conv-new" onClick={onNew}>+ new chat</button>
      <div className="conv-items">
        {conversations.length === 0 && (
          <div className="muted small" style={{ padding: 12 }}>no chats yet</div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`conv-item${activeId === c.id ? ' on' : ''}`}
            onClick={() => onPick(c.id)}
          >
            <div className="conv-title">{c.title || '(untitled)'}</div>
            <div className="conv-meta muted small">{fmtRelative(c.updated_at)}</div>
            <button
              type="button"
              className="conv-del"
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
              aria-label="delete"
              title="delete"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
