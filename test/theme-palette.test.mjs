import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Palette is a second, independent axis: the operator picks a color family
// (neutral or rose) and, separately, light/dark/system. Every combination has
// to be a complete, accessible theme, so the checks below read the real
// stylesheet rather than trusting that a block was authored correctly.

const ROLES = [
  '--canvas', '--surface', '--surface-secondary', '--ink', '--ink-muted',
  '--line', '--action', '--action-hover', '--action-soft', '--on-action',
  '--success', '--warning', '--danger', '--focus',
];

function declarationsFor(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing block for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out = {};
  for (const line of body.split(';')) {
    const match = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

// A theme is the base block plus whatever the more specific blocks override.
function resolvedTheme(css, palette, scheme) {
  const layers = [':root'];
  if (scheme === 'dark') layers.push(':root[data-color-scheme="dark"]');
  if (palette !== 'neutral') {
    layers.push(`:root[data-palette="${palette}"]`);
    if (scheme === 'dark') layers.push(`:root[data-palette="${palette}"][data-color-scheme="dark"]`);
  }
  return Object.assign({}, ...layers.map((selector) => declarationsFor(css, selector)));
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(match, `expected an opaque hex color, got ${hex}`);
  const int = parseInt(match[1], 16);
  return 0.2126 * channel((int >> 16) & 255)
    + 0.7152 * channel((int >> 8) & 255)
    + 0.0722 * channel(int & 255);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const COMBINATIONS = [
  ['neutral', 'light'], ['neutral', 'dark'],
  ['rose', 'light'], ['rose', 'dark'],
];

describe('palette and color-scheme design tokens', () => {
  const css = () => read('web/src/styles.css');

  it('replaces the green-dominant default with a neutral palette', () => {
    const neutral = resolvedTheme(css(), 'neutral', 'light');
    // The rejected default was #f3f2ed canvas with a #315f52 green action.
    assert.notEqual(neutral['--canvas'], '#f3f2ed');
    assert.notEqual(neutral['--action'], '#315f52');
  });

  it('keeps the neutral light canvas and surfaces free of a color cast', () => {
    const neutral = resolvedTheme(css(), 'neutral', 'light');
    for (const role of ['--canvas', '--surface', '--surface-secondary', '--ink', '--line']) {
      const int = parseInt(neutral[role].slice(1), 16);
      const parts = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
      const spread = Math.max(...parts) - Math.min(...parts);
      assert.ok(spread <= 14, `${role} (${neutral[role]}) has a ${spread}/255 color cast`);
    }
  });

  it('defines every semantic role for all four palette/scheme combinations', () => {
    const source = css();
    for (const [palette, scheme] of COMBINATIONS) {
      const theme = resolvedTheme(source, palette, scheme);
      for (const role of ROLES) {
        assert.ok(theme[role], `${palette}/${scheme} is missing ${role}`);
      }
    }
  });

  it('meets WCAG AA contrast for text and accent controls in every combination', () => {
    const source = css();
    for (const [palette, scheme] of COMBINATIONS) {
      const theme = resolvedTheme(source, palette, scheme);
      const pairs = [
        ['--ink', '--canvas'], ['--ink', '--surface'],
        ['--ink-muted', '--canvas'], ['--ink-muted', '--surface'],
        ['--on-action', '--action'],
        ['--danger', '--surface'], ['--success', '--surface'], ['--warning', '--surface'],
      ];
      for (const [fg, bg] of pairs) {
        const ratio = contrast(theme[fg], theme[bg]);
        assert.ok(ratio >= 4.5, `${palette}/${scheme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
      // Focus rings are a non-text indicator; AA needs 3:1 against both the
      // canvas they sit on and the surface they outline.
      for (const bg of ['--canvas', '--surface']) {
        const ratio = contrast(theme['--focus'], theme[bg]);
        assert.ok(ratio >= 3, `${palette}/${scheme}: --focus on ${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  it('keeps palettes to color roles, with no remote background assets', () => {
    assert.doesNotMatch(css(), /background-image:\s*url\("?https?:/);
  });
});

describe('palette selection contract', () => {
  let PALETTES, normalizePalette, nextPalette, metaThemeColor, paletteLabel;

  before(async () => {
    ({ PALETTES, normalizePalette, nextPalette, metaThemeColor, paletteLabel } =
      await import('../web/src/lib/theme.js'));
  });

  it('offers the neutral default and the rose palette', () => {
    assert.deepEqual(PALETTES, ['neutral', 'rose']);
  });

  it('falls back to neutral for unknown, missing, or legacy stored values', () => {
    assert.equal(normalizePalette('rose'), 'rose');
    assert.equal(normalizePalette('neutral'), 'neutral');
    assert.equal(normalizePalette('girly'), 'neutral');
    assert.equal(normalizePalette(null), 'neutral');
    assert.equal(normalizePalette(undefined), 'neutral');
  });

  it('cycles palettes deterministically', () => {
    assert.equal(nextPalette('neutral'), 'rose');
    assert.equal(nextPalette('rose'), 'neutral');
    assert.equal(nextPalette('nonsense'), 'rose');
  });

  it('gives every palette a human label for the control', () => {
    for (const palette of PALETTES) {
      assert.equal(typeof paletteLabel(palette), 'string');
      assert.ok(paletteLabel(palette).length > 0);
    }
  });

  it('reports a distinct status-bar color per palette and scheme', () => {
    const seen = new Set();
    for (const [palette, scheme] of COMBINATIONS) {
      const color = metaThemeColor(palette, scheme);
      assert.match(color, /^#[0-9a-f]{6}$/);
      seen.add(color);
    }
    assert.equal(seen.size, COMBINATIONS.length, 'each combination needs its own status-bar color');
  });

  it('matches the stylesheet canvas for each combination', () => {
    const source = read('web/src/styles.css');
    for (const [palette, scheme] of COMBINATIONS) {
      assert.equal(
        metaThemeColor(palette, scheme),
        resolvedTheme(source, palette, scheme)['--canvas'],
        `${palette}/${scheme} status-bar color must track --canvas`,
      );
    }
  });
});

describe('palette persistence and first-paint application', () => {
  it('persists the palette separately from the light/dark choice', () => {
    const source = read('web/src/lib/theme.js');
    assert.match(source, /helm_palette/);
    assert.match(source, /data-palette/);
  });

  it('applies the stored palette before React mounts so there is no flash', () => {
    const html = read('web/index.html');
    assert.match(html, /helm_palette/);
    assert.match(html, /data-palette/);
    // The pre-mount script must agree with useTheme: 'system' is the default,
    // and the resolved scheme drives both attributes.
    assert.match(html, /prefers-color-scheme:\s*dark/);
    assert.match(html, /data-color-scheme/);
  });

  it('exposes a labelled palette control in the shell', () => {
    const shell = read('web/src/components/shell/AppShell.jsx');
    assert.match(shell, /onCyclePalette/);
    assert.match(shell, /aria-label=\{`Color theme: \$\{paletteLabel\(palette\)\}`\}/);
    const app = read('web/src/App.jsx');
    assert.match(app, /usePalette/);
    assert.match(app, /onCyclePalette=\{cyclePalette\}/);
  });
});
