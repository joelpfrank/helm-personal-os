#!/usr/bin/env node

// Determinism gate: generate every public visual asset twice in
// isolated temporary directories, compare SHA-256 values between runs, then
// compare both runs with the tracked docs/assets package.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SCREENSHOTS,
  REQUIRED_STATIC_ASSETS,
} from './generate-demo-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join(ROOT, 'scripts', 'generate-demo-assets.mjs');
const TRACKED = path.join(ROOT, 'docs', 'assets');
const FILES = [...REQUIRED_SCREENSHOTS, ...REQUIRED_STATIC_ASSETS, 'helm-demo.mp4'].sort();

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function generate(outDir, label) {
  const result = spawnSync(process.execPath, [GENERATOR, '--out', outDir], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} generation failed\n${result.stderr || result.stdout}`);
  }
}

function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-demo-determinism-'));
  const runA = path.join(workDir, 'run-a');
  const runB = path.join(workDir, 'run-b');
  fs.mkdirSync(runA);
  fs.mkdirSync(runB);
  try {
    generate(runA, 'run A');
    generate(runB, 'run B');

    const failures = [];
    for (const file of FILES) {
      const hashes = {
        runA: sha256(path.join(runA, file)),
        runB: sha256(path.join(runB, file)),
        tracked: sha256(path.join(TRACKED, file)),
      };
      if (new Set(Object.values(hashes)).size !== 1) failures.push({ file, ...hashes });
    }
    if (failures.length > 0) {
      const detail = failures.map(({ file, runA: a, runB: b, tracked }) => (
        `${file}\n  run A:   ${a}\n  run B:   ${b}\n  tracked: ${tracked}`
      )).join('\n');
      throw new Error(`demo assets are not byte-stable:\n${detail}`);
    }
    process.stdout.write(`demo asset determinism: ${FILES.length}/${FILES.length} outputs match across two isolated runs and tracked assets\n`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
