import React, { useState } from 'react';

// A small dismissible "what is this?" banner shown once per screen for new
// users. Remembers dismissal in localStorage (keyed by id).
export default function FirstRunHint({ id, children }) {
  const key = 'helm_hint_' + id;
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(key) !== '1'; } catch { return true; }
  });
  if (!show) return null;
  // Presentation lives in styles.css (.first-run-hint) rather than inline, so
  // narrow viewports can compact the banner — inline styles would win over any
  // media query and keep a phone-sized screen paying desktop padding.
  return (
    <div className="first-run-hint">
      <div className="first-run-hint-body">{children}</div>
      <button
        type="button"
        className="first-run-hint-dismiss"
        onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } setShow(false); }}
        aria-label="dismiss"
      >×</button>
    </div>
  );
}
