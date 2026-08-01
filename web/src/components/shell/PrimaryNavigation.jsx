import React, { useRef } from 'react';

const ICON_PATHS = {
  tasks: <><path d="M4 6.5h2.5M9 6.5h11M4 12h2.5M9 12h11M4 17.5h2.5M9 17.5h11" /></>,
  food: <><path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10v11M10 3v4.5A2.5 2.5 0 0 1 7.5 10M17 3v18M17 3c2 1.5 3 3.8 3 6.5v2.5h-3" /></>,
  habits: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></>,
  workouts: <><path d="M6 8v8M3.5 10v4M18 8v8M20.5 10v4M6 12h12" /></>,
  coach: <><path d="M5 18.5A8.5 8.5 0 1 1 18.5 16L21 21l-5-2.5" /><path d="M8.5 10.5h7M8.5 14h4" /></>,
};

function SectionIcon({ id }) {
  return (
    <svg className="primary-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[id]}
    </svg>
  );
}

export default function PrimaryNavigation({ items, activeId, onSelect, labelFor }) {
  const navRef = useRef(null);

  function moveFocus(event) {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = [...navRef.current.querySelectorAll('.primary-nav-item')];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % buttons.length;
    else next = (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  return (
    <nav ref={navRef} className="primary-nav" aria-label="Primary" onKeyDown={moveFocus}>
      {items.map((item) => {
        const selected = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`primary-nav-item${selected ? ' is-selected' : ''}`}
            data-section={item.id}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
          >
            <SectionIcon id={item.id} />
            <span className="primary-nav-label">{labelFor(item.id)}</span>
          </button>
        );
      })}
    </nav>
  );
}
