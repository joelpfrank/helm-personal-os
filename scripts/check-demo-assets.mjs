#!/usr/bin/env node

// Validate the exact public media committed under docs/assets. This runs in the
// canonical `npm run check` gate, independently of asset generation, so a
// replaced or manually edited file cannot bypass the media contract.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REQUIRED_SCREENSHOTS,
  AssetToolError,
  pngDimensions,
  pngTextChunks,
  validateScreenshotMeta,
  validateVideoMetadata,
} from './generate-demo-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'docs', 'assets');
const VIDEO_FILE = 'helm-demo.mp4';
const ALLOWED_FILES = new Set([...REQUIRED_SCREENSHOTS, VIDEO_FILE]);
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
  const expected = [...ALLOWED_FILES].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    const missing = expected.filter((file) => !files.includes(file));
    const extra = files.filter((file) => !expected.includes(file));
    throw new AssetToolError(
      `docs/assets differs from the exact public media allow-list`
      + `\nmissing: ${missing.join(', ') || '(none)'}`
      + `\nextra: ${extra.join(', ') || '(none)'}`,
    );
  }
  for (const file of REQUIRED_SCREENSHOTS) validatePng(path.join(assetDir, file));
  validateVideo(path.join(assetDir, VIDEO_FILE));
  return { screenshots: REQUIRED_SCREENSHOTS.length, video: VIDEO_FILE };
}

function main() {
  const result = validateCommittedAssets();
  process.stdout.write(
    `demo assets: ${result.screenshots} screenshots and ${result.video} passed committed-media validation\n`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
