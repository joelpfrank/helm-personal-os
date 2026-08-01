import React, { useRef } from 'react';

export default function TrackingTabs({ className, label, idPrefix, tabs, selected, onSelect }) {
  const tabRefs = useRef([]);

  function handleKeyDown(event, index) {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
    onSelect(tabs[nextIndex].id);
  }

  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const active = selected === tab.id;
        return (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            className={active ? 'on' : ''}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
