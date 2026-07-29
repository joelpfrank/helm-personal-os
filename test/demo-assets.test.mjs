import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEMO_NOW,
  REQUIRED_SCREENSHOTS,
  parseArgs,
  screenshotPlan,
  videoPlan,
  videoEncodeArgs,
  resolvePlaywrightCore,
  resolveChromiumExecutable,
  pngDimensions,
  assertCaptionSafe,
  validateScreenshotMeta,
  validateVideoMetadata,
} from '../scripts/generate-demo-assets.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLOCK_SHIM = path.join(ROOT, 'scripts', 'demo-clock.mjs');

// A valid 1x1 PNG for header-parsing tests.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('demo asset argument parsing', () => {
  it('defaults to docs/assets with everything enabled', () => {
    const options = parseArgs([]);
    assert.equal(options.outDir, path.join(ROOT, 'docs', 'assets'));
    assert.equal(options.only, null);
    assert.equal(options.keepWork, false);
  });

  it('accepts --only screenshots|video and --keep-work', () => {
    assert.equal(parseArgs(['--only', 'screenshots']).only, 'screenshots');
    assert.equal(parseArgs(['--only', 'video']).only, 'video');
    assert.equal(parseArgs(['--keep-work']).keepWork, true);
  });

  it('fails closed on unknown flags and bad --only values', () => {
    assert.throws(() => parseArgs(['--database', '/tmp/x.db']), /unknown argument/);
    assert.throws(() => parseArgs(['--only', 'gifs']), /--only/);
    assert.throws(() => parseArgs(['--out']), /--out/);
  });
});

describe('screenshot plan', () => {
  it('produces exactly the four required public asset names', () => {
    const files = screenshotPlan().map((shot) => shot.file);
    assert.deepEqual([...files].sort(), [...REQUIRED_SCREENSHOTS].sort());
  });

  it('uses crisp 16:9 capture geometry for every shot', () => {
    for (const shot of screenshotPlan()) {
      assert.equal(shot.viewport.width / shot.viewport.height, 16 / 9, `${shot.file} viewport must be 16:9`);
      assert.ok(shot.deviceScaleFactor >= 2, `${shot.file} must render at 2x or better`);
    }
  });

  it('keeps every caption and label free of private identifiers', () => {
    for (const shot of screenshotPlan()) {
      for (const label of shot.labels || []) assertCaptionSafe(label);
    }
  });
});

describe('video plan', () => {
  it('is 16:9 at an allowed resolution and runs 60-90 seconds', () => {
    const plan = videoPlan();
    assert.ok(
      (plan.width === 1280 && plan.height === 720) || (plan.width === 1920 && plan.height === 1080),
      'video must be 1280x720 or 1920x1080',
    );
    const total = plan.segments.reduce((sum, segment) => sum + segment.seconds, 0);
    assert.ok(total >= 60 && total <= 90, `planned duration ${total}s must stay within 60-90s`);
  });

  it('captions every segment with safe, truthful text', () => {
    for (const segment of videoPlan().segments) {
      assert.ok(segment.caption?.trim().length > 0, 'every segment carries a caption');
      assertCaptionSafe(segment.caption);
      // The chat segment must not fabricate a provider reply.
      assert.ok(!/replied|answered|responded/i.test(segment.caption));
    }
  });
});

describe('caption safety', () => {
  it('rejects emails, user paths, and tokens', () => {
    assert.throws(() => assertCaptionSafe('mail me at a@' + 'b.com'));
    assert.throws(() => assertCaptionSafe('/Us' + 'ers/someone/secret'));
    assert.throws(() => assertCaptionSafe('/ho' + 'me/someone/secret'));
    assert.throws(() => assertCaptionSafe('Bearer deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));
    assert.doesNotThrow(() => assertCaptionSafe('Habits tracked with quantities and streaks.'));
  });
});

describe('media validation', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    assert.deepEqual(pngDimensions(ONE_BY_ONE_PNG), { width: 1, height: 1 });
    assert.throws(() => pngDimensions(Buffer.from('not a png')), /PNG/);
  });

  it('accepts only crisp 16:9 screenshots', () => {
    assert.doesNotThrow(() => validateScreenshotMeta({ width: 3200, height: 1800 }));
    assert.throws(() => validateScreenshotMeta({ width: 3200, height: 1799 }), /16:9/);
    assert.throws(() => validateScreenshotMeta({ width: 1280, height: 720 }), /at least/);
  });

  it('accepts only silent H.264 yuv420p video within 60-90s', () => {
    const good = {
      streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1280, height: 720 }],
      format: { duration: '75.02' },
    };
    assert.doesNotThrow(() => validateVideoMetadata(good));
    assert.throws(() => validateVideoMetadata({
      ...good,
      streams: [{ ...good.streams[0], codec_name: 'vp9' }],
    }), /h264/);
    assert.throws(() => validateVideoMetadata({
      ...good,
      streams: [{ ...good.streams[0], pix_fmt: 'yuv444p' }],
    }), /yuv420p/);
    assert.throws(() => validateVideoMetadata({ ...good, format: { duration: '12.0' } }), /duration/);
    assert.throws(() => validateVideoMetadata({
      ...good,
      streams: [...good.streams, { codec_type: 'audio', codec_name: 'aac' }],
    }), /silent/);
  });

  it('encodes video without audio, without metadata, as faststart H.264 yuv420p', () => {
    const args = videoEncodeArgs('/tmp/in.webm', '/tmp/out.mp4');
    for (const expected of ['libx264', 'yuv420p', '-an', '-map_metadata', '+faststart']) {
      assert.ok(args.some((arg) => String(arg).includes(expected)), `ffmpeg args must include ${expected}`);
    }
  });
});

describe('fail-closed tool resolution', () => {
  it('refuses to run without playwright-core rather than degrading', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-assets-none-'));
    try {
      assert.throws(
        () => resolvePlaywrightCore({ env: {}, searchRoots: [empty] }),
        /playwright-core/,
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('prefers an explicit HELM_PLAYWRIGHT_CORE_DIR override', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-assets-pw-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"playwright-core"}');
      const resolved = resolvePlaywrightCore({ env: { HELM_PLAYWRIGHT_CORE_DIR: dir }, searchRoots: [] });
      assert.equal(resolved, dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to run without a Chromium binary rather than degrading', () => {
    assert.throws(
      () => resolveChromiumExecutable({ env: {}, candidates: ['/nonexistent/chrome'] }),
      /Chromium/,
    );
  });

  it('prefers an explicit HELM_CHROMIUM override when the file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-assets-chrome-'));
    const fake = path.join(dir, 'chrome');
    try {
      fs.writeFileSync(fake, '#!/bin/sh\n');
      const resolved = resolveChromiumExecutable({ env: { HELM_CHROMIUM: fake }, candidates: [] });
      assert.equal(resolved, fake);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('frozen demo clock shim', () => {
  it('freezes Date when HELM_DEMO_NOW is set', () => {
    const result = spawnSync(process.execPath, [
      '--import', CLOCK_SHIM,
      '-e', 'console.log(new Date().toISOString(), Date.now())',
    ], {
      encoding: 'utf8',
      env: { ...process.env, HELM_DEMO_NOW: '2026-01-13T18:30:00.000Z' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `2026-01-13T18:30:00.000Z ${Date.parse('2026-01-13T18:30:00.000Z')}`);
  });

  it('fails closed on an unparseable HELM_DEMO_NOW instead of using real time', () => {
    const result = spawnSync(process.execPath, [
      '--import', CLOCK_SHIM,
      '-e', 'console.log(Date.now())',
    ], {
      encoding: 'utf8',
      env: { ...process.env, HELM_DEMO_NOW: 'not-a-date' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HELM_DEMO_NOW/);
  });

  it('leaves real time untouched when HELM_DEMO_NOW is unset', () => {
    const env = { ...process.env };
    delete env.HELM_DEMO_NOW;
    const result = spawnSync(process.execPath, [
      '--import', CLOCK_SHIM,
      '-e', 'console.log(Date.now())',
    ], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const reported = Number(result.stdout.trim());
    assert.ok(Math.abs(reported - Date.now()) < 60_000, 'unset shim must report real time');
  });

  it('pins the demo clock to the seeded fictional week', () => {
    assert.equal(new Date(DEMO_NOW).toISOString().slice(0, 10), '2026-01-13');
  });
});

describe('public asset documentation contract', () => {
  it('exposes one reproducible command and links every required asset with descriptive text', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const development = fs.readFileSync(path.join(ROOT, 'docs', 'DEVELOPMENT.md'), 'utf8');

    assert.equal(pkg.scripts['demo:assets'], 'node scripts/generate-demo-assets.mjs');
    assert.equal(pkg.scripts['demo:check'], 'node scripts/check-demo-assets.mjs');
    assert.match(pkg.scripts.check, /npm run demo:check/);
    assert.match(development, /Reproducing the demo assets/);
    for (const file of REQUIRED_SCREENSHOTS) {
      const escaped = file.replaceAll('.', '[.]');
      assert.match(readme, new RegExp(`!\\[[^\\]]{20,}\\]\\(docs/assets/${escaped}\\)`));
    }
    assert.match(readme, /\[`?docs\/assets\/helm-demo[.]mp4`?\]\(docs\/assets\/helm-demo[.]mp4\)/);
    assert.match(readme, /\[Technical case study\]\(docs\/CASE-STUDY[.]md\)/);
    assert.match(readme, /deliberately silent/i);
    assert.doesNotMatch(readme, /workout(?:'s)? logged sets, weights, and reps/i);
  });
});
