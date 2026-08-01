#!/usr/bin/env node

// Reproducible generator for Helm's public visual assets (docs/assets).
//
// Everything on screen is the fictional Port Aurora workspace produced by
// scripts/create-demo-workspace.mjs — never live data. The pipeline is
// deliberately fail-closed and isolated:
//
//   - the demo database is seeded into a fresh temp directory (the seeding
//     script itself refuses Helm's default data path and non-blank targets);
//   - the server runs on a random loopback port with a one-process random
//     bearer token (NODE_TEST_CONTEXT prevents any token file from being
//     written to disk);
//   - both the seeding step and the server run under scripts/demo-clock.mjs
//     with HELM_DEMO_NOW frozen, so "today" is always the seeded fictional
//     week regardless of when assets are regenerated;
//   - the browser is Chromium driven by playwright-core with a fresh
//     disposable profile per launch, discarded on close;
//   - captured media is validated (16:9 geometry, H.264/yuv420p, 60-90s,
//     silent, metadata stripped, no PNG text chunks) before it is kept.
//
// Browser tooling stays out of package.json on purpose. playwright-core is
// resolved from an existing local installation (see resolvePlaywrightCore);
// to provide one without touching any manifest run:
//
//   npm install --no-save playwright-core
//
// or point HELM_PLAYWRIGHT_CORE_DIR at an existing package directory. The
// Chromium binary comes from Playwright's browser cache (npx playwright
// install chromium), an installed Google Chrome, or HELM_CHROMIUM.
// ffmpeg/ffprobe are required for the video only.

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REQUIRED_STATIC_ASSETS,
  architectureAssetHtml,
  launchAssetPlan,
  launchCarouselHtml,
  validateLaunchImageMeta,
} from './launch-assets.mjs';
import { isEntrypoint } from './lib/tree-context.mjs';

export {
  REQUIRED_STATIC_ASSETS,
  architectureAssetHtml,
  launchAssetPlan,
  launchCarouselHtml,
  validateLaunchImageMeta,
} from './launch-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLOCK_SHIM = path.join(ROOT, 'scripts', 'demo-clock.mjs');
const SEED_SCRIPT = path.join(ROOT, 'scripts', 'create-demo-workspace.mjs');

// Frozen instant for every asset run: a Tuesday evening inside the seeded
// fictional week, so logged habits, meals, and check-ins all read naturally.
export const DEMO_NOW = '2026-01-13T18:30:00.000Z';
export const DEMO_TIMEZONE = 'UTC';
export const VIDEO_ROUTE_SETTLE_MS = 900;

export function chromiumLaunchArgs() {
  return [
    '--disable-gpu',
    '--disable-font-subpixel-positioning',
    '--disable-lcd-text',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
  ];
}

export function deterministicContextOptions() {
  return {
    timezoneId: DEMO_TIMEZONE,
    locale: 'en-US',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  };
}

export const REQUIRED_SCREENSHOTS = [
  'helm-today.png',
  'helm-coach.png',
  'helm-tasks.png',
  'helm-habits-workouts.png',
];

export class AssetToolError extends Error {}

// ---------------------------------------------------------------------------
// Pure, testable planning + validation helpers
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    outDir: path.join(ROOT, 'docs', 'assets'),
    only: null,
    keepWork: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new AssetToolError('--out requires a directory path');
      options.outDir = path.resolve(ROOT, value);
      i += 1;
    } else if (arg === '--only') {
      const value = argv[i + 1];
      if (!['screenshots', 'video', 'static'].includes(value)) {
        throw new AssetToolError('--only accepts "screenshots", "video", or "static"');
      }
      options.only = value;
      i += 1;
    } else if (arg === '--keep-work') {
      options.keepWork = true;
    } else {
      throw new AssetToolError(`unknown argument: ${arg}`);
    }
  }
  return options;
}

// Each shot is a real app view (or an honest side-by-side composition of two
// real app views) rendered at 16:9 with a 2x+ device scale for crispness.
export function screenshotPlan() {
  return [
    {
      file: 'helm-today.png',
      kind: 'view',
      hash: '#section=coach&ctab=today',
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 2,
    },
    {
      file: 'helm-coach.png',
      kind: 'view',
      hash: '#section=coach&ctab=vision',
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 2,
    },
    {
      file: 'helm-tasks.png',
      kind: 'view',
      hash: '#section=tasks',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2.5,
    },
    {
      // The app has no single screen combining habits and workouts, so this
      // is a labeled two-panel composition of two real screenshots — no
      // fabricated UI.
      file: 'helm-habits-workouts.png',
      kind: 'composite',
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 2,
      labels: ['Habits', 'Workouts'],
      panels: [
        { label: 'Habits', hash: '#section=habits', viewport: { width: 762, height: 806 } },
        {
          label: 'Workouts',
          hash: '#section=workouts&wo=history',
          viewport: { width: 762, height: 806 },
          clickText: 'Patient Strength A',
        },
      ],
    },
  ];
}

// The video narrative: real UI, frozen fictional data, a caption per segment.
// The chat segment types a message but never sends it — no provider call is
// made and no reply is shown.
export function videoRoutePlan() {
  return {
    workouts: '#section=workouts&wo=history',
  };
}

export function videoPlan() {
  return {
    width: 1280,
    height: 720,
    fps: 30,
    segments: [
      { id: 'intro', seconds: 6, caption: 'Helm — a local-first personal OS: goals, tasks, habits, food, workouts, and an evidence-grounded coach.' },
      { id: 'vision', seconds: 8, caption: 'Direction first: a written north star, an identity statement, and values.' },
      { id: 'goals', seconds: 9, caption: 'Goals cascade from year to quarter to week, with observable success criteria and if-then plans for known obstacles.' },
      { id: 'today', seconds: 8, caption: 'Each day opens with a command meeting: one must-win task, real constraints.' },
      { id: 'tasks', seconds: 9, caption: 'Tasks stay on simple boards — work and life side by side.' },
      { id: 'chat', seconds: 9, caption: 'The coach accepts plain language through an optional configured AI provider. No message is sent in this demo.' },
      { id: 'habits', seconds: 8, caption: 'Habits track real quantities — minutes and pages, not just checkmarks.' },
      { id: 'workouts', seconds: 8, caption: 'Workouts are logged set by set from reusable routines.' },
      { id: 'food', seconds: 7, caption: 'Meals and macro targets land in the same system.' },
      { id: 'review', seconds: 8, caption: 'The weekly review is grounded in that recorded evidence — wins, misses, adjustments.' },
      { id: 'outro', seconds: 5, caption: 'Synthetic demo data. MIT licensed. Runs on your own machine.' },
    ],
  };
}

const CAPTION_FORBIDDEN = [
  { label: 'email address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}/ },
  { label: 'user home path', pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+/ },
  { label: 'hex secret', pattern: /[0-9a-f]{40,}/i },
  { label: 'bearer token', pattern: /bearer\s+\S+/i },
];

export function assertCaptionSafe(text) {
  for (const { label, pattern } of CAPTION_FORBIDDEN) {
    if (pattern.test(text)) {
      throw new AssetToolError(`caption contains a ${label}: ${JSON.stringify(text)}`);
    }
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    throw new AssetToolError('not a PNG file');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function pngTextChunks(buffer) {
  const found = [];
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return found;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) break;
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) found.push(type);
    offset = chunkEnd;
  }
  return found;
}

export function validateScreenshotMeta({ width, height }) {
  if (width * 9 !== height * 16) {
    throw new AssetToolError(`screenshot is ${width}x${height}, not 16:9`);
  }
  if (width < 1920) {
    throw new AssetToolError(`screenshot is ${width}px wide; expected at least 1920px for crisp output`);
  }
}

export function validateVideoMetadata(probe) {
  const videoStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  if (videoStreams.length !== 1) throw new AssetToolError('video must contain exactly one video stream');
  const [video] = videoStreams;
  if (video.codec_name !== 'h264') throw new AssetToolError(`video codec is ${video.codec_name}; must be h264`);
  if (video.pix_fmt !== 'yuv420p') throw new AssetToolError(`pixel format is ${video.pix_fmt}; must be yuv420p`);
  const sizeOk = (video.width === 1280 && video.height === 720) || (video.width === 1920 && video.height === 1080);
  if (!sizeOk) throw new AssetToolError(`video is ${video.width}x${video.height}; must be 1280x720 or 1920x1080`);
  const duration = Number(probe.format?.duration);
  if (!(duration >= 60 && duration <= 90)) {
    throw new AssetToolError(`video duration ${duration}s is outside the required 60-90s window`);
  }
  if (audioStreams.length !== 0) {
    throw new AssetToolError('video must stay deliberately silent (no audio streams)');
  }
}

export function videoEncodeArgs(input, output) {
  const duration = videoPlan().segments.reduce((sum, segment) => sum + segment.seconds, 0);
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0',
    '-i', input,
    '-t', String(duration),
    '-vf', 'scale=1280:720:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '20',
    '-threads', '1',
    '-fflags', '+bitexact',
    '-flags:v', '+bitexact',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-map_metadata', '-1',
    '-metadata', 'encoder=',
    '-movflags', '+faststart',
    output,
  ];
}

export function resolvePlaywrightCore({ env = process.env, searchRoots } = {}) {
  const override = env.HELM_PLAYWRIGHT_CORE_DIR;
  if (override) {
    if (fs.existsSync(path.join(override, 'package.json'))) return override;
    throw new AssetToolError(`HELM_PLAYWRIGHT_CORE_DIR does not contain a playwright-core package: ${override}`);
  }
  const roots = searchRoots ?? [
    path.join(ROOT, 'node_modules'),
    path.join(os.homedir(), '.npm', '_npx'),
  ];
  for (const root of roots) {
    const direct = path.join(root, 'playwright-core');
    if (fs.existsSync(path.join(direct, 'package.json'))) return direct;
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      const nested = path.join(root, entry, 'node_modules', 'playwright-core');
      if (fs.existsSync(path.join(nested, 'package.json'))) return nested;
    }
  }
  throw new AssetToolError(
    'playwright-core not found. It is dev-only tooling and intentionally not a package.json dependency. '
    + 'Install it without touching any manifest via "npm install --no-save playwright-core", '
    + 'or set HELM_PLAYWRIGHT_CORE_DIR to an existing playwright-core package directory.',
  );
}

export function defaultChromiumCandidates({ homedir = os.homedir(), platform = process.platform } = {}) {
  const candidates = [];
  const cacheRoot = platform === 'darwin'
    ? path.join(homedir, 'Library', 'Caches', 'ms-playwright')
    : path.join(homedir, '.cache', 'ms-playwright');
  let entries = [];
  try { entries = fs.readdirSync(cacheRoot).sort().reverse(); } catch { /* no cache */ }
  for (const entry of entries) {
    if (entry.startsWith('chromium-')) {
      candidates.push(
        path.join(cacheRoot, entry, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(cacheRoot, entry, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(cacheRoot, entry, 'chrome-linux', 'chrome'),
      );
    } else if (entry.startsWith('chromium_headless_shell-')) {
      candidates.push(
        path.join(cacheRoot, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(cacheRoot, entry, 'chrome-headless-shell-linux', 'chrome-headless-shell'),
      );
    }
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return candidates;
}

export function resolveChromiumExecutable({ env = process.env, candidates } = {}) {
  const override = env.HELM_CHROMIUM;
  if (override) {
    if (fs.existsSync(override)) return override;
    throw new AssetToolError(`HELM_CHROMIUM does not exist: ${override}`);
  }
  for (const candidate of candidates ?? defaultChromiumCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new AssetToolError(
    'No Chromium binary found. Run "npx playwright install chromium" (kept in Playwright\'s cache, '
    + 'not in this repository) or set HELM_CHROMIUM to a Chromium/Chrome executable.',
  );
}

// ---------------------------------------------------------------------------
// Driver (only runs when executed directly)
// ---------------------------------------------------------------------------

function fail(message) {
  process.stderr.write(`generate-demo-assets: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stderr.write(`generate-demo-assets: ${message}\n`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function seedDemoDatabase(dbPath) {
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(CLOCK_SHIM).href,
    SEED_SCRIPT, '--database', dbPath, '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HELM_DEMO_NOW: DEMO_NOW, TZ: DEMO_TIMEZONE },
  });
  if (result.status !== 0) {
    throw new AssetToolError(`demo workspace seeding failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

async function startServer(dbPath, port, token) {
  const child = spawn(process.execPath, [
    '--import', pathToFileURL(CLOCK_SHIM).href,
    'server/src/index.js',
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DASHBOARD_DB_PATH: dbPath,
      NODE_TEST_CONTEXT: 'helm-demo-assets',
      DASHBOARD_TOKEN: token,
      HELM_DEMO_NOW: DEMO_NOW,
      TZ: DEMO_TIMEZONE,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { child, base };
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGKILL');
  throw new AssetToolError(`demo server did not become healthy on ${base}\n${stderrTail}`);
}

const BOOTSTRAP_STORAGE = () => {
  // Skip the intro and the first-run hints so captures show the product.
  try {
    localStorage.setItem('helm_intro_seen', '1');
    localStorage.setItem('helm_hint_today', '1');
    localStorage.setItem('helm_hint_library', '1');
    localStorage.setItem('helm_hint_chat', '1');
  } catch { /* ignore */ }
};

const DETERMINISTIC_CAPTURE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition: none !important;
  }
`;

async function stabilizePage(page) {
  await page.addStyleTag({ content: DETERMINISTIC_CAPTURE_CSS });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function preparePage(context, base, token, hash) {
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(DEMO_NOW));
  await page.addInitScript(BOOTSTRAP_STORAGE);
  await page.goto(`${base}/?token=${token}${hash || ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await stabilizePage(page);
  return page;
}

async function switchTab(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.waitForTimeout(900);
}

async function captureViewShot(browser, base, token, shot, targetPath) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.deviceScaleFactor,
    ...deterministicContextOptions(),
  });
  try {
    const page = await preparePage(context, base, token, shot.hash);
    if (shot.tab) await switchTab(page, shot.tab);
    await page.screenshot({ path: targetPath });
  } finally {
    await context.close();
  }
}

async function capturePanel(browser, base, token, panel, targetPath) {
  const context = await browser.newContext({
    viewport: panel.viewport,
    deviceScaleFactor: 2,
    ...deterministicContextOptions(),
  });
  try {
    const page = await preparePage(context, base, token, panel.hash);
    if (panel.tab) await switchTab(page, panel.tab);
    if (panel.clickText) {
      await page.getByText(panel.clickText, { exact: false }).first().click();
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: targetPath });
  } finally {
    await context.close();
  }
}

function compositeHtml(shot, panelFiles) {
  const panels = shot.panels.map((panel, index) => `
      <figure>
        <figcaption>${panel.label}</figcaption>
        <img src="${panelFiles[index]}" alt="" width="${panel.viewport.width}" height="${panel.viewport.height}">
      </figure>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${shot.viewport.width}px; height: ${shot.viewport.height}px; background: #0e1014; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; gap: 30px;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  figure { margin: 0; }
  figcaption { color: #8b93a1; font-size: 13px; font-weight: 600; letter-spacing: 0.14em;
               text-transform: uppercase; margin: 0 2px 10px; }
  img { display: block; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.09); }
</style></head><body>${panels}
</body></html>
`;
}

async function captureCompositeShot(browser, base, token, shot, workDir, targetPath) {
  const panelFiles = [];
  for (const [index, panel] of shot.panels.entries()) {
    const panelFile = `panel-${index}-${panel.label.toLowerCase()}.png`;
    await capturePanel(browser, base, token, panel, path.join(workDir, panelFile));
    panelFiles.push(panelFile);
  }
  const htmlPath = path.join(workDir, 'composite.html');
  fs.writeFileSync(htmlPath, compositeHtml(shot, panelFiles));
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.deviceScaleFactor,
    ...deterministicContextOptions(),
  });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href);
    await stabilizePage(page);
    await page.screenshot({ path: targetPath });
  } finally {
    await context.close();
  }
}

async function captureStaticAsset(browser, asset, workDir, targetPath) {
  const html = asset.kind === 'architecture'
    ? architectureAssetHtml()
    : launchCarouselHtml(asset.slide);
  const htmlPath = path.join(workDir, `${asset.file}.html`);
  fs.writeFileSync(htmlPath, html);
  const context = await browser.newContext({
    viewport: asset.viewport,
    deviceScaleFactor: asset.deviceScaleFactor,
    ...deterministicContextOptions(),
  });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await stabilizePage(page);
    await page.screenshot({ path: targetPath });
  } finally {
    await context.close();
  }
}

function validatePngFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const dimensions = pngDimensions(buffer);
  validateScreenshotMeta(dimensions);
  const textChunks = pngTextChunks(buffer);
  if (textChunks.length > 0) {
    throw new AssetToolError(`${path.basename(filePath)} contains PNG text chunks (${textChunks.join(', ')})`);
  }
  return { ...dimensions, bytes: buffer.length };
}

function validateLaunchPngFile(filePath, contract) {
  const buffer = fs.readFileSync(filePath);
  const dimensions = pngDimensions(buffer);
  validateLaunchImageMeta(dimensions, contract);
  const textChunks = pngTextChunks(buffer);
  if (textChunks.length > 0) {
    throw new AssetToolError(`${path.basename(filePath)} contains PNG text chunks (${textChunks.join(', ')})`);
  }
  return { ...dimensions, bytes: buffer.length };
}

// --- video -----------------------------------------------------------------

const CAPTION_SETUP = (text) => {
  let bar = document.getElementById('helm-demo-caption');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'helm-demo-caption';
    bar.style.cssText = [
      'position: fixed', 'left: 50%', 'bottom: 26px', 'transform: translateX(-50%)',
      'max-width: 82%', 'padding: 11px 22px', 'border-radius: 999px',
      'background: rgba(8, 10, 14, 0.92)', 'border: 1px solid rgba(255, 255, 255, 0.16)',
      'color: #eef1f6', 'font: 500 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'text-align: center', 'z-index: 2147483647', 'pointer-events: none',
      'box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45)',
    ].join(';');
    document.body.appendChild(bar);
  }
  bar.textContent = text;
};

const TITLE_OVERLAY = ({ title, subtitle, show }) => {
  let overlay = document.getElementById('helm-demo-title');
  if (!show) { overlay?.remove(); return; }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'helm-demo-title';
    overlay.style.cssText = [
      'position: fixed', 'inset: 0', 'background: #0e1014', 'z-index: 2147483646',
      'display: flex', 'flex-direction: column', 'align-items: center', 'justify-content: center',
      'gap: 14px', 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    ].join(';');
    const heading = document.createElement('div');
    heading.style.cssText = 'color:#eef1f6;font-size:54px;font-weight:700;letter-spacing:-0.02em';
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#8b93a1;font-size:19px;max-width:70%;text-align:center;line-height:1.5';
    overlay.append(heading, sub);
    document.body.appendChild(overlay);
  }
  overlay.children[0].textContent = title;
  overlay.children[1].textContent = subtitle;
};

async function setCaption(page, text) {
  await page.evaluate(CAPTION_SETUP, text);
}

async function recordDemoVideo(browser, base, token, workDir) {
  const plan = videoPlan();
  const context = await browser.newContext({
    viewport: { width: plan.width, height: plan.height },
    deviceScaleFactor: 2,
    ...deterministicContextOptions(),
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(DEMO_NOW));
    await page.addInitScript(BOOTSTRAP_STORAGE);
    await page.goto(`${base}/?token=${token}#section=coach&ctab=today`, { waitUntil: 'networkidle' });
    await stabilizePage(page);

    const goto = async (hash) => {
      await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(VIDEO_ROUTE_SETTLE_MS);
      await stabilizePage(page);
    };
    const scrollBy = async (top) => {
      await page.evaluate((distance) => {
        const scroller = document.scrollingElement || document.documentElement;
        scroller.scrollBy({ top: distance, behavior: 'auto' });
      }, top);
    };

    // Per-segment actions. Anything decorative is best-effort so a selector
    // drift can never abort a run mid-recording; the narrative stays truthful
    // without the flourish.
    const attempt = async (action) => { try { await action(); } catch { /* optional flourish */ } };
    const actions = {
      intro: async () => {
        await page.evaluate(TITLE_OVERLAY, {
          show: true,
          title: 'Helm',
          subtitle: 'A local-first personal OS — everything below is fictional, synthetic demo data.',
        });
      },
      vision: async () => {
        await page.evaluate(TITLE_OVERLAY, { show: false, title: '', subtitle: '' });
        await goto('#section=coach&ctab=vision');
      },
      goals: async () => {
        await goto('#section=coach&ctab=goals');
        // Unfold the goal tree: year -> quarter -> week.
        for (let i = 0; i < 3; i += 1) {
          await attempt(async () => {
            await page.locator('button', { hasText: '▸' }).first().click({ timeout: 1500 });
            await page.waitForTimeout(650);
          });
        }
      },
      today: async () => {
        await goto('#section=coach&ctab=today');
      },
      tasks: async () => {
        await goto('#section=tasks');
        await attempt(async () => {
          await page.getByText('Assemble the field guide proof', { exact: true }).click({ timeout: 2000 });
          await page.waitForTimeout(2600);
          await page.keyboard.press('Escape');
        });
      },
      chat: async () => {
        await goto('#section=coach&ctab=chat');
        await attempt(async () => {
          const composer = page.locator('textarea').last();
          await composer.click({ timeout: 2000 });
          await composer.fill('Plan tomorrow around the guide proof, please.');
        });
        // Deliberately never sent: no provider is configured and no reply is
        // shown or implied.
      },
      habits: async () => {
        await goto('#section=habits');
      },
      workouts: async () => {
        await goto(videoRoutePlan().workouts);
        await attempt(async () => {
          await page.getByText('Patient Strength A', { exact: false }).first().click({ timeout: 2000 });
        });
      },
      food: async () => {
        await goto('#section=food');
        await attempt(() => scrollBy(320));
      },
      review: async () => {
        await goto('#section=coach&ctab=checkins');
        await attempt(() => scrollBy(420));
      },
      outro: async () => {
        await goto('#section=coach&ctab=today');
        await page.evaluate(TITLE_OVERLAY, {
          show: true,
          title: 'Helm',
          subtitle: 'Local-first. Open source (MIT). Shown with synthetic demo data only.',
        });
      },
    };

    const frames = [];
    for (const [index, segment] of plan.segments.entries()) {
      await actions[segment.id]?.();
      await setCaption(page, segment.caption);
      await stabilizePage(page);
      const framePath = path.join(workDir, `video-frame-${String(index).padStart(2, '0')}-${segment.id}.png`);
      await page.screenshot({ path: framePath });
      frames.push({ framePath, seconds: segment.seconds });
    }

    const escapeConcatPath = (filePath) => filePath.replaceAll("'", "'\\''");
    const concatPath = path.join(workDir, 'video-frames.ffconcat');
    const concat = ['ffconcat version 1.0'];
    for (const frame of frames) {
      concat.push(`file '${escapeConcatPath(frame.framePath)}'`, `duration ${frame.seconds}`);
    }
    concat.push(`file '${escapeConcatPath(frames.at(-1).framePath)}'`);
    fs.writeFileSync(concatPath, `${concat.join('\n')}\n`);
    return concatPath;
  } finally {
    await context.close();
  }
}

function encodeVideo(concatPath, outputPath) {
  const encode = spawnSync('ffmpeg', videoEncodeArgs(concatPath, outputPath), { encoding: 'utf8' });
  if (encode.status !== 0) throw new AssetToolError(`ffmpeg encode failed:\n${encode.stderr}`);
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outputPath,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new AssetToolError(`ffprobe failed:\n${probe.stderr}`);
  const metadata = JSON.parse(probe.stdout);
  validateVideoMetadata(metadata);
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  return {
    duration_s: Number(metadata.format.duration),
    width: video.width,
    height: video.height,
    codec: video.codec_name,
    pix_fmt: video.pix_fmt,
    audio: 'none (deliberately silent; captions carry the narration)',
    bytes: fs.statSync(outputPath).size,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const wantScreenshots = options.only === null || options.only === 'screenshots';
  const wantVideo = options.only === null || options.only === 'video';
  const wantStatic = options.only === null || options.only === 'static';

  for (const segment of videoPlan().segments) assertCaptionSafe(segment.caption);
  for (const shot of screenshotPlan()) for (const label of shot.labels || []) assertCaptionSafe(label);

  if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
    throw new AssetToolError('web/dist is missing — run "npm run build:web" first');
  }
  if (wantVideo) {
    for (const tool of ['ffmpeg', 'ffprobe']) {
      if (spawnSync(tool, ['-version'], { stdio: 'ignore' }).error) {
        throw new AssetToolError(`${tool} is required for video generation and was not found on PATH`);
      }
    }
  }

  const playwrightDir = resolvePlaywrightCore();
  const chromiumPath = resolveChromiumExecutable();
  const { chromium } = createRequire(path.join(ROOT, 'package.json'))(playwrightDir);
  log(`playwright-core: ${playwrightDir}`);
  log(`chromium: ${chromiumPath}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-demo-assets-'));
  const dbPath = path.join(workDir, 'demo.db');
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(options.outDir, { recursive: true });

  let server = null;
  let browser = null;
  const report = { demo_now: DEMO_NOW, files: {} };
  try {
    const seeded = seedDemoDatabase(dbPath);
    log(`seeded fictional workspace (${Object.values(seeded.counts).reduce((a, b) => a + b, 0)} records)`);

    const port = await freePort();
    server = await startServer(dbPath, port, token);
    log(`demo server on ${server.base} (random loopback port, ephemeral token)`);

    // chromium.launch() gives every run a fresh disposable profile that
    // Playwright deletes when the browser closes.
    browser = await chromium.launch({
      executablePath: chromiumPath,
      headless: true,
      args: chromiumLaunchArgs(),
    });

    if (wantScreenshots) {
      for (const shot of screenshotPlan()) {
        const targetPath = path.join(options.outDir, shot.file);
        if (shot.kind === 'composite') {
          await captureCompositeShot(browser, server.base, token, shot, workDir, targetPath);
        } else {
          await captureViewShot(browser, server.base, token, shot, targetPath);
        }
        report.files[shot.file] = validatePngFile(targetPath);
        log(`captured ${shot.file} (${report.files[shot.file].width}x${report.files[shot.file].height})`);
      }
    }

    if (wantStatic) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'helm-architecture.html'), architectureAssetHtml());
      for (const asset of launchAssetPlan()) {
        const targetPath = path.join(options.outDir, asset.file);
        await captureStaticAsset(browser, asset, workDir, targetPath);
        report.files[asset.file] = validateLaunchPngFile(targetPath, asset);
        log(`captured ${asset.file} (${report.files[asset.file].width}x${report.files[asset.file].height})`);
      }
    }

    if (wantVideo) {
      const concatPath = await recordDemoVideo(browser, server.base, token, workDir);
      const outputPath = path.join(options.outDir, 'helm-demo.mp4');
      report.files['helm-demo.mp4'] = encodeVideo(concatPath, outputPath);
      log(`encoded helm-demo.mp4 (${report.files['helm-demo.mp4'].duration_s.toFixed(1)}s)`);
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server?.child && server.child.exitCode === null) {
      server.child.kill('SIGTERM');
      await new Promise((resolve) => {
        server.child.once('exit', resolve);
        setTimeout(() => { server.child.kill('SIGKILL'); resolve(); }, 3000).unref();
      });
    }
    if (options.keepWork) log(`work dir kept: ${workDir}`);
    else fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error) => fail(error instanceof AssetToolError ? error.message : error.stack));
}
