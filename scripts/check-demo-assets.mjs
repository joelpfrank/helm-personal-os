#!/usr/bin/env node

// Validate the exact public media committed under docs/assets. This runs in the
// canonical `npm run check` gate, independently of asset generation, so a
// replaced or manually edited file cannot bypass the media contract.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SCREENSHOTS,
  REQUIRED_STATIC_ASSETS,
  AssetToolError,
  launchAssetPlan,
  pngDimensions,
  pngTextChunks,
  validateLaunchImageMeta,
  validateScreenshotMeta,
  validateVideoMetadata,
} from './generate-demo-assets.mjs';
import { PORTABLE_EXCLUDED_FILES } from './check-public-safety.mjs';
import { isEntrypoint } from './lib/tree-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'docs', 'assets');
const VIDEO_FILE = 'helm-demo.mp4';
// The demo video and the LinkedIn carousel are withheld from the public export
// (see PORTABLE_EXCLUDED_FILES), so a fresh recipient runs this same gate
// without them. They are validated whenever they are present — which is always
// in the private working tree — and never merely tolerated as unknown extras.
// That set also withholds non-media files, which this gate has no opinion on:
// take only the entries that live in the directory it validates.
const LOCAL_ONLY_FILES = new Set(
  [...PORTABLE_EXCLUDED_FILES]
    .filter((relative) => path.dirname(relative) === 'docs/assets')
    .map((relative) => path.basename(relative)),
);
const PUBLISHED_FILES = [...REQUIRED_SCREENSHOTS, ...REQUIRED_STATIC_ASSETS, VIDEO_FILE]
  .filter((file) => !LOCAL_ONLY_FILES.has(file));
const ALLOWED_FILES = new Set([...PUBLISHED_FILES, ...LOCAL_ONLY_FILES]);
const IDENTIFYING_VIDEO_TAGS = new Set([
  'artist',
  'author',
  'comment',
  'copyright',
  'creation_time',
  'description',
  'location',
  'title',
]);

function requireRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AssetToolError(`${path.basename(filePath)} must be a regular non-symlink file`);
  }
}

function validatePng(filePath) {
  requireRegularFile(filePath);
  const buffer = fs.readFileSync(filePath);
  validateScreenshotMeta(pngDimensions(buffer));
  const textChunks = pngTextChunks(buffer);
  if (textChunks.length > 0) {
    throw new AssetToolError(`${path.basename(filePath)} contains PNG text metadata (${textChunks.join(', ')})`);
  }
}

function validateLaunchPng(filePath, contract) {
  requireRegularFile(filePath);
  const buffer = fs.readFileSync(filePath);
  validateLaunchImageMeta(pngDimensions(buffer), contract);
  const textChunks = pngTextChunks(buffer);
  if (textChunks.length > 0) {
    throw new AssetToolError(`${path.basename(filePath)} contains PNG text metadata (${textChunks.join(', ')})`);
  }
}

function probeVideo(filePath) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') {
    throw new AssetToolError('ffprobe is required by the canonical demo-asset gate');
  }
  if (probe.status !== 0) {
    throw new AssetToolError(`ffprobe rejected ${path.basename(filePath)}: ${probe.stderr.trim()}`);
  }
  return JSON.parse(probe.stdout);
}

function validateVideo(filePath) {
  requireRegularFile(filePath);
  const metadata = probeVideo(filePath);
  validateVideoMetadata(metadata);
  for (const record of [metadata.format, ...(metadata.streams || [])]) {
    for (const key of Object.keys(record?.tags || {})) {
      if (IDENTIFYING_VIDEO_TAGS.has(key.toLowerCase())) {
        throw new AssetToolError(`${path.basename(filePath)} contains identifying metadata tag: ${key}`);
      }
    }
  }
}

export function validateCommittedAssets(assetDir = ASSET_DIR) {
  const entries = fs.readdirSync(assetDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const missing = PUBLISHED_FILES.filter((file) => !files.includes(file)).sort();
  const extra = files.filter((file) => !ALLOWED_FILES.has(file));
  if (missing.length > 0 || extra.length > 0) {
    throw new AssetToolError(
      `docs/assets differs from the exact public media allow-list`
      + `\nmissing: ${missing.join(', ') || '(none)'}`
      + `\nextra: ${extra.join(', ') || '(none)'}`,
    );
  }
  const present = (file) => files.includes(file);
  for (const file of REQUIRED_SCREENSHOTS) validatePng(path.join(assetDir, file));
  for (const asset of launchAssetPlan()) {
    if (present(asset.file)) validateLaunchPng(path.join(assetDir, asset.file), asset);
  }
  if (present(VIDEO_FILE)) validateVideo(path.join(assetDir, VIDEO_FILE));
  return {
    screenshots: REQUIRED_SCREENSHOTS.length,
    staticAssets: REQUIRED_STATIC_ASSETS.filter(present).length,
    localOnly: files.filter((file) => LOCAL_ONLY_FILES.has(file)).sort(),
  };
}

function main() {
  const result = validateCommittedAssets();
  const localOnly = result.localOnly.length > 0
    ? `, plus ${result.localOnly.length} local-only asset(s) withheld from publication`
    : '';
  process.stdout.write(
    `demo assets: ${result.screenshots} screenshots and ${result.staticAssets} launch assets`
    + ` passed committed-media validation${localOnly}\n`,
  );
}

if (isEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
