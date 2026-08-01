import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCallBlock from './ToolCallBlock.jsx';

// Renders one message turn. The user/assistant role + the array of
// content blocks (text / tool_use / tool_result) drive the layout.

function findToolResult(allMessages, toolUseId) {
  for (const m of allMessages) {
    if (m.role !== 'user') continue;
    for (const b of m.content || []) {
      if (b.type === 'tool_result' && b.tool_use_id === toolUseId) return b;
    }
  }
  return null;
}

export default function MessageBubble({ message, allMessages }) {
  const role = message.role;
  const blocks = message.content || [];

  // Skip user messages that are pure tool_result blocks — they're rendered
  // inline with the corresponding tool_use in the prior assistant turn.
  if (role === 'user' && blocks.every((b) => b.type === 'tool_result')) return null;

  return (
    <div className={`msg msg-${role}`}>
      {blocks.map((b, i) => {
        if (b.type === 'text') {
          return (
            <div key={i} className="msg-text">
              {role === 'assistant'
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text || ''}</ReactMarkdown>
                : <span>{b.text}</span>}
            </div>
          );
        }
        if (b.type === 'image' && b.source?.type === 'base64') {
          const url = `data:${b.source.media_type};base64,${b.source.data}`;
          return (
            <a key={i} className="msg-image" href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt="attachment" />
            </a>
          );
        }
        if (b.type === 'document' && b.source?.type === 'base64') {
          return (
            <div key={i} className="msg-doc" title="PDF attachment">
              <span>📄</span>
              <span>{b.source.media_type || 'document'}</span>
            </div>
          );
        }
        if (b.type === 'tool_use') {
          const tr = findToolResult(allMessages, b.id);
          const ok = tr ? !tr.is_error : undefined;
          return (
            <ToolCallBlock
              key={i}
              name={b.name}
              input={b.input}
              result={tr?.content}
              ok={ok}
              error={tr?.is_error ? tr.content : undefined}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
