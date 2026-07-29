import React, { useState } from 'react';

export default function ToolCallBlock({ name, input, result, ok, error }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = ok !== undefined;
  const failed = ok === false;

  return (
    <div className={`tool-call ${failed ? 'failed' : isDone ? 'done' : 'pending'}`}>
      <button
        type="button"
        className="tool-call-head"
        onClick={() => setExpanded((x) => !x)}
      >
        <span className="tool-call-icon">
          {!isDone ? '...' : failed ? '!' : '✓'}
        </span>
        <span className="tool-call-name">{name}</span>
        {!isDone && <span className="muted small">running...</span>}
        {failed && <span className="err small">{error}</span>}
        <span className="tool-call-toggle">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="tool-call-body">
          {input != null && (
            <>
              <div className="tool-call-label">input</div>
              <pre className="tool-call-pre">{JSON.stringify(input, null, 2)}</pre>
            </>
          )}
          {result != null && (
            <>
              <div className="tool-call-label">result</div>
              <pre className="tool-call-pre">{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
