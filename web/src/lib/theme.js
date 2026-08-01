import { useEffect, useState } from 'react';

const KEY = 'dashboard_theme';
const PALETTE_KEY = 'helm_palette';

export const THEMES = ['system', 'light', 'dark'];

// Palette (color family) is deliberately separate from light/dark, so an
// operator can pick rose and still follow the system's light/dark preference.
export const PALETTES = ['neutral', 'rose'];

const PALETTE_LABELS = {
  neutral: 'Neutral',
  rose: 'Rose',
};

// Status-bar color per combination; must track --canvas in styles.css.
const META_COLOR = {
  neutral: { light: '#f4f5f6', dark: '#131519' },
  rose:    { light: '#fff5fa', dark: '#1a1016' },
};

export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'system';
}

export function normalizePalette(value) {
  return PALETTES.includes(value) ? value : 'neutral';
}

export function resolveColorScheme(theme, prefersDark) {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

export function nextTheme(t) {
  const i = THEMES.indexOf(t);
  return THEMES[(i + 1) % THEMES.length];
}

export function nextPalette(p) {
  const i = PALETTES.indexOf(normalizePalette(p));
  return PALETTES[(i + 1) % PALETTES.length];
}

export function paletteLabel(p) {
  return PALETTE_LABELS[normalizePalette(p)];
}

export function metaThemeColor(palette, scheme) {
  return META_COLOR[normalizePalette(palette)][scheme === 'dark' ? 'dark' : 'light'];
}

function readStored(key, normalize) {
  if (typeof window === 'undefined') return normalize(undefined);
  try { return normalize(localStorage.getItem(key)); }
  catch { return normalize(undefined); }
}

function currentPalette() {
  return normalizePalette(document.documentElement.getAttribute('data-palette'));
}

// Both hooks write the same meta tag, so each one reads the other axis off the
// DOM rather than keeping a second copy of the state.
function applyMetaColor(palette, scheme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', metaThemeColor(palette, scheme));
}

export function useTheme() {
  const [theme, setTheme] = useState(() => readStored(KEY, normalizeTheme));
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = resolveColorScheme(theme, media.matches);
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.setAttribute('data-color-scheme', resolved);
      document.documentElement.style.colorScheme = resolved;
      applyMetaColor(currentPalette(), resolved);
    };
    try { localStorage.setItem(KEY, theme); } catch { /* storage may be unavailable */ }
    apply();
    if (theme !== 'system') return undefined;
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [theme]);
  return [theme, setTheme];
}

export function usePalette() {
  const [palette, setPalette] = useState(() => readStored(PALETTE_KEY, normalizePalette));
  useEffect(() => {
    try { localStorage.setItem(PALETTE_KEY, palette); } catch { /* storage may be unavailable */ }
    document.documentElement.setAttribute('data-palette', palette);
    const scheme = document.documentElement.getAttribute('data-color-scheme') || 'light';
    applyMetaColor(palette, scheme);
  }, [palette]);
  return [palette, setPalette];
}
