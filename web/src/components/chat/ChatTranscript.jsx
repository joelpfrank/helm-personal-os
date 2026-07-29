import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';
import ToolCallBlock from './ToolCallBlock.jsx';

export default function ChatTranscript({ messages, pendingAssistant, streaming }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingAssistant?.text, pendingAssistant?.toolCalls?.length, streaming]);

  return (
    <div className="chat-transcript" ref={scrollRef}>
      {messages.length === 0 && !pendingAssistant && (
        <div className="chat-empty muted center-pad">
          Ask anything about your dashboard. Examples:
          <ul style={{ marginTop: 10, textAlign: 'left', display: 'inline-block' }}>
            <li>"Review my overdue tasks and help me choose one priority."</li>
            <li>"Add a task to call the dentist."</li>
            <li>"How am I doing on my habits this week?"</li>
            <li>"Start a workout called Push A and log 80kg × 5 on Bench Press."</li>
          </ul>
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} allMessages={messages} />
      ))}
      {pendingAssistant && (
        <div className="msg msg-assistant">
          {pendingAssistant.text && (
            <div className="msg-text"><span>{pendingAssistant.text}</span>{streaming && <span className="cursor">▍</span>}</div>
          )}
          {pendingAssistant.toolCalls.map((tc) => (
            <ToolCallBlock
              key={tc.id}
              name={tc.name}
              input={tc.input}
              ok={tc.ok}
              error={tc.error}
            />
          ))}
          {!pendingAssistant.text && pendingAssistant.toolCalls.length === 0 && (
            <div className="muted small">thinking{streaming ? '…' : ''}</div>
          )}
        </div>
      )}
    </div>
  );
}
