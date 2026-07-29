import React from 'react';
import { PRESET_COLORS } from '../lib/color.js';

export { PRESET_COLORS };

export default function ColorSwatch({ value, onChange }) {
  return (
    <div className="color-swatch">
      <button
        type="button"
        className={`color-dot${value == null ? ' selected' : ''}`}
        style={{ background: 'transparent', borderStyle: 'dashed' }}
        onClick={() => onChange(null)}
        aria-label="no color"
        title="no color"
      >∅</button>
      {PRESET_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className={`color-dot${value === c ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
          title={c}
        />
      ))}
      <input
        type="color"
        className="color-custom"
        value={value || '#888888'}
        onChange={(e) => onChange(e.target.value)}
        title="custom color"
      />
    </div>
  );
}
