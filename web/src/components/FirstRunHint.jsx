import React, { useState } from 'react';

// A small dismissible "what is this?" banner shown once per screen for new
// users. Remembers dismissal in localStorage (keyed by id).
export default function FirstRunHint({ id, children }) {
  const key = 'helm_hint_' + id;
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(key) !== '1'; } catch { return true; }
  });
  if (!show) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      margin: '12px 16px', padding: '12px 14px',
      background: 'var(--accent-soft)',
      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
      borderRadius: 'var(--radius)', fontSize: '13.5px', lineHeight: 1.45, color: 'var(--text)',
    }}>
      <div style={{ flex: 1 }}>{children}</div>
      <button
        type="button"
        onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } setShow(false); }}
        aria-label="dismiss"
        style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '18px', lineHeight: 1, padding: 0, minWidth: '24px', cursor: 'pointer' }}
      >×</button>
    </div>
  );
}
