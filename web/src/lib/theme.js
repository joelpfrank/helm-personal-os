import { useEffect, useState } from 'react';

const KEY = 'dashboard_theme';

export const THEMES = ['dark', 'light', 'girly'];

// Meta theme-color values per theme (drives iOS status bar).
const META_COLOR = {
  dark:  '#14161b',
  light: '#ffffff',
  girly: '#fff5fa',
};

export function nextTheme(t) {
  const i = THEMES.indexOf(t);
  return THEMES[(i + 1) % THEMES.length];
}

function readInitial() {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(KEY);
  return THEMES.includes(stored) ? stored : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState(readInitial);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLOR[theme] || META_COLOR.dark);
  }, [theme]);
  return [theme, setTheme];
}
