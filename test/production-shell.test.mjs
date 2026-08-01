import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { maintainerOnly } from '../scripts/lib/tree-context.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

describe('Quiet Instrument design-token contract', () => {
  const css = () => read('web/src/styles.css');

  it('defines the accepted semantic light and dark color roles', () => {
    const source = css();
    for (const token of [
      '--canvas', '--surface', '--surface-secondary', '--ink', '--ink-muted',
      '--line', '--action', '--action-hover', '--action-soft', '--on-action',
      '--success', '--warning', '--danger', '--focus',
    ]) assert.match(source, new RegExp(`${token}:`), `missing ${token}`);
    // Palette-specific values live in test/theme-palette.test.mjs; this only
    // pins that the neutral default is the base block and dark overrides it.
    assert.match(source, /--canvas:\s*#f4f5f6/);
    assert.match(source, /:root\[data-color-scheme="dark"\][\s\S]*--canvas:\s*#131519/);
  });

  it('defines the accepted typography, spacing, shape, elevation, and motion tokens', () => {
    const source = css();
    for (const pair of [
      ['--font-ui', '-apple-system'], ['--text-body', '16px'], ['--text-meta', '13px'],
      ['--space-1', '8px'], ['--space-4', '32px'], ['--radius-control', '8px'],
      ['--radius-group', '14px'], ['--radius-focal', '22px'], ['--motion-fast', '120ms'],
      ['--motion-default', '180ms'], ['--motion-slow', '240ms'],
    ]) assert.match(source, new RegExp(`${pair[0]}:[^;]*${pair[1]}`), `missing ${pair[0]}=${pair[1]}`);
  });

  it('maps legacy component variables onto semantic roles during staged view migration', () => {
    const source = css();
    assert.match(source, /--bg:\s*var\(--canvas\)/);
    assert.match(source, /--panel:\s*var\(--surface\)/);
    assert.match(source, /--text:\s*var\(--ink\)/);
    assert.match(source, /--accent:\s*var\(--action\)/);
  });
});

describe('production application shell', () => {
  it('uses focused shell components without changing domain view ownership', () => {
    assert.ok(exists('web/src/components/shell/AppShell.jsx'));
    assert.ok(exists('web/src/components/shell/PrimaryNavigation.jsx'));
    const app = read('web/src/App.jsx');
    assert.match(app, /from '\.\/components\/shell\/AppShell\.jsx'/);
    assert.match(app, /<AppShell/);
    for (const view of ['TasksView', 'FoodView', 'HabitsView', 'WorkoutsView', 'CoachHubView']) {
      assert.match(app, new RegExp(`<${view}\\s*/>`));
    }
  });

  it('exposes one labelled primary navigation with selected-section semantics', () => {
    const nav = read('web/src/components/shell/PrimaryNavigation.jsx');
    assert.match(nav, /aria-label="Primary"/);
    assert.match(nav, /aria-current=\{selected \? 'page' : undefined\}/);
    assert.match(nav, /data-section=\{item\.id\}/);
  });

  it('supports arrow, Home, and End keyboard focus movement', () => {
    const nav = read('web/src/components/shell/PrimaryNavigation.jsx');
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']) {
      assert.match(nav, new RegExp(key));
    }
    assert.match(nav, /\.focus\(\)/);
  });

  it('keeps shell utilities labelled and section content focusable', () => {
    const shell = read('web/src/components/shell/AppShell.jsx');
    assert.match(shell, /aria-label="Helm"/);
    assert.match(shell, /aria-label="Workspace controls"/);
    assert.match(shell, /id="main-content"/);
    assert.match(shell, /tabIndex=\{-1\}/);
  });
});

describe('system and explicit theme contract', () => {
  let resolveColorScheme, normalizeTheme, nextTheme, THEMES;

  before(async () => {
    ({ resolveColorScheme, normalizeTheme, nextTheme, THEMES } = await import('../web/src/lib/theme.js'));
  });

  it('offers system, light, and dark choices', () => {
    assert.deepEqual(THEMES, ['system', 'light', 'dark']);
  });

  it('normalizes old or invalid values to system while retaining explicit values', () => {
    assert.equal(normalizeTheme('light'), 'light');
    assert.equal(normalizeTheme('dark'), 'dark');
    assert.equal(normalizeTheme('girly'), 'system');
    assert.equal(normalizeTheme(null), 'system');
  });

  it('resolves system preference without changing the stored choice', () => {
    assert.equal(resolveColorScheme('system', true), 'dark');
    assert.equal(resolveColorScheme('system', false), 'light');
    assert.equal(resolveColorScheme('dark', false), 'dark');
    assert.equal(resolveColorScheme('light', true), 'light');
  });

  it('cycles through all choices deterministically', () => {
    assert.equal(nextTheme('system'), 'light');
    assert.equal(nextTheme('light'), 'dark');
    assert.equal(nextTheme('dark'), 'system');
  });
});

// Returns the body of one @media block. Matching a rule with `[\s\S]*` from
// the @media line only proves the rule exists somewhere after it, which is not
// the same claim as "this breakpoint sets it".
function mediaBlock(source, query) {
  const start = source.indexOf(`@media (${query})`);
  assert.notEqual(start, -1, `no @media (${query}) block`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && (depth -= 1) === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unterminated @media (${query}) block`);
}

describe('responsive, focus, and motion shell safeguards', () => {
  const css = () => read('web/src/styles.css');
  const AppShell = read('web/src/components/shell/AppShell.jsx');

  it('contains the application and gives compact navigation 44px targets', () => {
    const source = css();
    assert.match(source, /html,\s*body,\s*#root[\s\S]*overflow:\s*hidden/);
    assert.match(source, /@media\s*\(max-width:\s*720px\)[\s\S]*\.primary-nav-item[\s\S]*min-height:\s*44px/);
    assert.match(source, /@media\s*\(max-width:\s*720px\)[\s\S]*\.coach-tab[\s\S]*min-height:\s*44px/);
    assert.match(source, /\.app-content[\s\S]*min-width:\s*0[\s\S]*min-height:\s*0/);
  });

  // The phone app bar has two ways to swallow its own page title, and the
  // responsive harness catches neither: both are vertical/z-order, not
  // horizontal overflow. Rule 1 — the bar is one grid row whose height must
  // absorb env(safe-area-inset-top); pin it to a fixed pixel height and on a
  // notched iPhone the title renders below the bar, under the view. Rule 2 —
  // the utility icons float over the bar as position:fixed, so the bar has to
  // reserve their exact width; state that width twice and the two drift until
  // the icons sit on top of the title. Rule 3 — the bar shares a grid column
  // with the view, so an unpinned column lets a wide view stretch the bar and
  // push the title under the icons anyway.
  it('keeps the phone app bar from swallowing the page title', () => {
    const block = mediaBlock(css(), 'max-width: 720px');
    const workspaceRows = /\.app-workspace\s*\{[^}]*grid-template-rows:\s*([^;]+);/.exec(block);
    assert.ok(workspaceRows, '.app-workspace must set grid-template-rows at phone widths');
    assert.doesNotMatch(
      workspaceRows[1], /^\s*\d/,
      'the app-bar row must size to its content so the safe-area inset cannot push the title out of it',
    );

    const clusterWidth = /--mobile-utilities-width:\s*(\d+)px/.exec(block);
    assert.ok(clusterWidth, 'the floating utility cluster width must be declared once, as a variable');
    const buttons = (AppShell.match(/className="shell-icon-button/g) || []).length;
    const buttonSize = /\.app-utilities \.shell-icon-button\s*\{[^}]*width:\s*(\d+)px/.exec(block);
    assert.ok(buttonSize, '.app-utilities buttons must set an explicit width at phone widths');
    assert.equal(
      Number(clusterWidth[1]), buttons * Number(buttonSize[1]),
      `the declared cluster width must equal ${buttons} icon buttons — adding or removing one must update it`,
    );
    assert.match(
      block, /\.app-utilities\s*\{[^}]*width:\s*var\(--mobile-utilities-width\)/,
      'the cluster must take its width from the variable the bar reserves against',
    );
    assert.match(
      block, /\.workspace-header\s*\{[^}]*padding:[^;]*var\(--mobile-utilities-width\)/,
      'the bar must reserve the cluster width from that same variable, not a copied number',
    );

    assert.match(
      css(), /\.app-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
      'the workspace column must be pinned so an overflowing view cannot stretch the app bar',
    );
  });

  it('uses the semantic on-action color for legacy accent controls in dark mode', () => {
    const source = css();
    assert.match(source, /\.cadence-cta\s*\{[^}]*color:\s*var\(--accent-contrast\)/s);
    assert.match(source, /\.set-check\.on\s*\{[^}]*color:\s*var\(--accent-contrast\)/s);
  });

  it('uses a dedicated, high-contrast focus token', () => {
    const source = css();
    assert.match(source, /:focus-visible[\s\S]*var\(--focus\)/);
  });

  it('removes nonessential animation and transforms for reduced motion', () => {
    const source = css();
    assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(source, /animation-duration:\s*0\.01ms\s*!important/);
    assert.match(source, /transform:\s*none\s*!important/);
  });
});

describe('synthetic browser verifier isolation', {
  // The verifier lives in the maintainer-only .hermes build-control namespace,
  // which the published archive withholds.
  skip: maintainerOnly('the browser-verifier isolation contract'),
}, () => {
  it('builds a scrubbed environment rooted entirely in the disposable workspace', async () => {
    const { buildIsolatedEnv } = await import('../.hermes/design/m2-verifier-isolation.mjs');
    const env = buildIsolatedEnv({
      sourceEnv: {
        PATH: '/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
        HOME: '/private/operator',
        HELM_STATE_DIR: '/private/operator/helm',
        HELM_COACH_BOT_TOKEN: 'must-not-survive',
        GOOGLE_CLIENT_SECRET: 'must-not-survive',
        ANTHROPIC_API_KEY: 'must-not-survive',
      },
      workDir: '/tmp/helm-verifier',
      databasePath: '/tmp/helm-verifier/synthetic.db',
      token: 'ephemeral-token',
      port: 43210,
    });

    assert.deepEqual(Object.keys(env).sort(), [
      'DASHBOARD_DB_PATH', 'DASHBOARD_TOKEN', 'HELM_DEMO_NOW', 'HELM_STATE_DIR',
      'HOME', 'HOST', 'LANG', 'NODE_TEST_CONTEXT', 'PATH', 'PORT', 'TMPDIR', 'TZ',
    ]);
    assert.equal(env.HOME, '/tmp/helm-verifier/home');
    assert.equal(env.HELM_STATE_DIR, '/tmp/helm-verifier/state');
    assert.equal(env.DASHBOARD_DB_PATH, '/tmp/helm-verifier/synthetic.db');
    assert.equal(env.DASHBOARD_TOKEN, 'ephemeral-token');
    assert.equal(env.PORT, '43210');
  });

  it('boots the verifier-only entrypoint rather than the production side-effect entrypoint', () => {
    const verifier = read('.hermes/design/verify-m2-production-shell.mjs');
    assert.doesNotMatch(verifier, /server\/src\/index\.js/);
    assert.match(verifier, /m2-isolated-server\.mjs/);
    assert.match(verifier, /buildIsolatedEnv/);
    assert.doesNotMatch(verifier, /\.\.\.process\.env/);
  });

  it('allows only read requests and the local language-setting write used by the shell', async () => {
    const { isVerifierRequestAllowed } = await import('../.hermes/design/m2-verifier-isolation.mjs');
    assert.equal(isVerifierRequestAllowed('GET', '/api/boards'), true);
    assert.equal(isVerifierRequestAllowed('PATCH', '/api/chat/settings'), true);
    for (const [method, url] of [
      ['POST', '/api/calendar/sync'],
      ['POST', '/api/agents/1/run'],
      ['POST', '/api/notify'],
      ['POST', '/api/channels/telegram/test'],
      ['DELETE', '/api/cards/1'],
    ]) assert.equal(isVerifierRequestAllowed(method, url), false, `${method} ${url} must be blocked`);
  });
});
