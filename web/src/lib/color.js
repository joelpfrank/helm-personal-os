export const PRESET_COLORS = [
  '#6aa3ff', '#8a6aff', '#ff6abf',
  '#ff6a6a', '#ffa66a', '#f0d96a',
  '#6affa0', '#6affe5',
];

// Stable hash → preset color, so the same tag name always gets the same color.
export function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PRESET_COLORS[h % PRESET_COLORS.length];
}

// Pick a foreground that contrasts with a #RRGGBB background.
export function pickFg(hex) {
  if (!hex) return '#ffffff';
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? '#0b0e14' : '#ffffff';
}
