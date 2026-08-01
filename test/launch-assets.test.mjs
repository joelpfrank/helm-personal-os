import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  REQUIRED_STATIC_ASSETS,
  architectureAssetHtml,
  launchAssetPlan,
  launchCarouselHtml,
  validateLaunchImageMeta,
} from '../scripts/generate-demo-assets.mjs';
import { maintainerOnly } from '../scripts/lib/tree-context.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Architecture and LinkedIn launch assets', () => {
  it('defines one architecture visual and three portrait carousel slides', () => {
    assert.deepEqual(REQUIRED_STATIC_ASSETS, [
      'helm-architecture.png',
      'helm-linkedin-01-product.png',
      'helm-linkedin-02-architecture.png',
      'helm-linkedin-03-method.png',
    ]);

    const plan = launchAssetPlan();
    assert.deepEqual(plan.map((asset) => asset.file), REQUIRED_STATIC_ASSETS);
    assert.deepEqual(plan[0].viewport, { width: 1920, height: 1080 });
    for (const slide of plan.slice(1)) {
      assert.deepEqual(slide.viewport, { width: 1080, height: 1350 });
      assert.equal(slide.deviceScaleFactor, 2);
    }
  });

  it('validates architecture and portrait media against their declared geometry', () => {
    assert.doesNotThrow(() => validateLaunchImageMeta(
      { width: 3840, height: 2160 },
      { aspect: '16:9', minWidth: 1920 },
    ));
    assert.doesNotThrow(() => validateLaunchImageMeta(
      { width: 2160, height: 2700 },
      { aspect: '4:5', minWidth: 1080 },
    ));
    assert.throws(() => validateLaunchImageMeta(
      { width: 2160, height: 2699 },
      { aspect: '4:5', minWidth: 1080 },
    ), /4:5/);
    assert.throws(() => validateLaunchImageMeta(
      { width: 1000, height: 1250 },
      { aspect: '4:5', minWidth: 1080 },
    ), /at least/);
  });

  it('shows the actual local runtime and both optional AI paths without inventing infrastructure', () => {
    const html = architectureAssetHtml();
    for (const truth of [
      /Browser on this Mac/i,
      /Express API/i,
      /SQLite/i,
      /Provider gateway/i,
      /Claude Code/i,
      /Anthropic.*OpenAI.*Gemini.*OpenRouter/is,
      /MCP client/i,
      /stdio/i,
      /authenticated HTTP/i,
      /127[.]0[.]0[.]1/i,
      /selected context leaves the Mac/i,
    ]) {
      assert.match(html, truth);
    }
    for (const flow of ['api-to-gateway', 'gateway-to-tools', 'tools-to-api', 'gateway-to-claude-code', 'gateway-to-api-profiles']) {
      assert.match(html, new RegExp(`data-flow="${flow}"`));
    }
    assert.doesNotMatch(html, /data-flow="gateway-to-sqlite"/);
    assert.doesNotMatch(html, /AWS|Kubernetes|multi-tenant|end-to-end encrypted/i);
  });

  it('keeps carousel copy concise, synthetic, unpublished, and free of unsupported claims', () => {
    const html = launchCarouselHtml();
    assert.match(html, /Port Aurora/i);
    assert.match(html, /synthetic/i);
    assert.match(html, /unpublished v0 launch candidate/i);
    assert.match(html, /React.*Express.*SQLite/is);
    assert.match(html, /one repository writer/i);
    assert.match(html, /AI.*optional/is);
    assert.doesNotMatch(html, /users|customers|revenue|model[- ]agnostic|effortless|fully local AI/i);
  });

  it('ships a standalone, dependency-free architecture artifact', () => {
    const architecture = read('docs/helm-architecture.html');

    assert.match(architecture, /<!doctype html>/i);
    assert.match(architecture, /Helm v0 architecture/i);
    assert.doesNotMatch(architecture, /<script|https?:\/\//i);
    assert.match(read('README.md'), /docs\/assets\/helm-architecture[.]png/);
  });

  // The manifest is withheld from the public export with the media it
  // describes, so a recipient legitimately does not have it to check.
  it('keeps the maintainer launch-media manifest in step with the generator', {
    skip: maintainerOnly('the launch-media manifest'),
  }, () => {
    const guide = read('docs/LAUNCH-ASSETS.md');

    for (const file of REQUIRED_STATIC_ASSETS) {
      assert.match(guide, new RegExp(file.replaceAll('.', '[.]')));
    }
    assert.match(guide, /not an outbound LinkedIn post/i);
    assert.match(guide, /4:5/i);
    assert.match(guide, /demo:verify-determinism/i);
  });
});
