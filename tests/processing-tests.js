/**
 * processing-tests.js — automated tests for the processing/ engine.
 *
 * These run under plain Node (no browser, no canvas, no test framework)
 * because every processing/ module operates on duck-typed
 * {data, width, height} objects rather than the DOM's ImageData class.
 * Run with: node tests/processing-tests.js
 */

import assert from 'node:assert/strict';

import { resizeBilinear, fitWithinLongEdge } from '../processing/resize.js';
import { analyzeImage } from '../processing/analyzer.js';
import { computeExposureAdjustment } from '../processing/exposure.js';
import { applyWhiteBalance } from '../processing/whiteBalance.js';
import { applyToneCurve } from '../processing/toneMap.js';
import { applyColorGrading } from '../processing/color.js';
import { applyLocalContrast } from '../processing/contrast.js';
import { applySharpen } from '../processing/sharpen.js';
import { estimateShift, shiftImage, alignFrames } from '../processing/align.js';
import { denoise } from '../processing/denoise.js';
import { fuseExposures } from '../processing/hdr.js';
import { stackFrames } from '../processing/night.js';
import { buildFaceMask } from '../processing/faceProtect.js';
import { applyPortraitBlur } from '../processing/portrait.js';
import { detectDocumentEdges, perspectiveCorrect } from '../processing/document.js';
import { runPipeline } from '../processing/pipeline.js';

// ---------- test helpers ----------

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${e.message}`);
  }
}

function makeSolidImage(w, h, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

function makeGradientImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round((x / (w - 1)) * 255);
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function makeSplitImage(w, h, leftGray, rightGray) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x < w / 2 ? leftGray : rightGray;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function makeCheckerWithNoise(w, h, seed = 1) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = x < w / 2 ? 60 : 180;
      const noise = (rand() - 0.5) * 40;
      const v = Math.max(0, Math.min(255, base + noise));
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function meanLumOf(img) {
  const { data } = img;
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  return s / n;
}

function localVariance(img, x0, x1) {
  const { data, width, height } = img;
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l; sumSq += l * l; n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

console.log('processing/ engine — automated tests\n');

// ---------- resize.js ----------
test('resizeBilinear: dimensions match request', () => {
  const img = makeGradientImage(40, 30);
  const out = resizeBilinear(img, 20, 15);
  assert.equal(out.width, 20);
  assert.equal(out.height, 15);
  assert.equal(out.data.length, 20 * 15 * 4);
});

test('fitWithinLongEdge: no-op when already within bound', () => {
  const img = makeSolidImage(100, 50, 10, 20, 30);
  const out = fitWithinLongEdge(img, 200);
  assert.equal(out.width, 100);
  assert.equal(out.height, 50);
});

test('fitWithinLongEdge: downscales oversized image proportionally', () => {
  const img = makeSolidImage(4000, 3000, 10, 20, 30);
  const out = fitWithinLongEdge(img, 2000);
  assert.equal(out.width, 2000);
  assert.equal(out.height, 1500);
});

// ---------- analyzer.js ----------
test('analyzeImage: uniform mid-gray image gives meanLuminance near 0.5, low noise/edges', () => {
  const img = makeSolidImage(64, 64, 128, 128, 128);
  const a = analyzeImage(img);
  assert.ok(Math.abs(a.meanLuminance - 128 / 255) < 0.01, `meanLuminance=${a.meanLuminance}`);
  assert.ok(a.noiseEstimate < 0.05, `noiseEstimate=${a.noiseEstimate}`);
  assert.ok(a.edgeDensity < 0.05, `edgeDensity=${a.edgeDensity}`);
  assert.equal(a.histogram.reduce((s, v) => s + v, 0), 64 * 64);
});

test('analyzeImage: near-black image reports shadow clipping', () => {
  const img = makeSolidImage(32, 32, 1, 1, 1);
  const a = analyzeImage(img);
  assert.ok(a.shadowClipping > 0.9, `shadowClipping=${a.shadowClipping}`);
});

test('analyzeImage: near-white image reports highlight clipping', () => {
  const img = makeSolidImage(32, 32, 254, 254, 254);
  const a = analyzeImage(img);
  assert.ok(a.highlightClipping > 0.9, `highlightClipping=${a.highlightClipping}`);
});

// ---------- exposure.js ----------
test('computeExposureAdjustment: dark image -> positive ev, bright image -> negative ev', () => {
  const dark = computeExposureAdjustment(analyzeImage(makeSolidImage(16, 16, 20, 20, 20)));
  const bright = computeExposureAdjustment(analyzeImage(makeSolidImage(16, 16, 235, 235, 235)));
  assert.ok(dark.ev > 0, `dark ev=${dark.ev}`);
  assert.ok(bright.ev < 0, `bright ev=${bright.ev}`);
});

// ---------- whiteBalance.js ----------
test('applyWhiteBalance: daylight preset is a no-op', () => {
  const img = makeSolidImage(8, 8, 100, 150, 200);
  const before = [...img.data];
  applyWhiteBalance(img, 'daylight');
  assert.deepEqual([...img.data], before);
});

test('applyWhiteBalance: auto reduces a strong green cast', () => {
  const img = makeSolidImage(32, 32, 100, 180, 100);
  applyWhiteBalance(img, 'auto');
  const gCastAfter = img.data[1] - (img.data[0] + img.data[2]) / 2;
  assert.ok(gCastAfter < 80, `residual green cast=${gCastAfter}`);
});

// ---------- toneMap.js ----------
test('applyToneCurve: output stays within byte range for extreme params', () => {
  const img = makeGradientImage(50, 10);
  applyToneCurve(img, { ev: 0.3, shadowLift: 0.35, highlightCompression: 0.5, contrast: 0.3 });
  for (const v of img.data) assert.ok(v >= 0 && v <= 255);
});

// ---------- color.js ----------
test('applyColorGrading: pure gray pixels stay gray (no hue to boost)', () => {
  const img = makeSolidImage(8, 8, 120, 120, 120);
  applyColorGrading(img, { saturation: 0.3, vibrance: 0.3 });
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i], img.data[i + 1]);
    assert.equal(img.data[i + 1], img.data[i + 2]);
  }
});

// ---------- contrast.js / sharpen.js no-op guards ----------
test('applyLocalContrast: amount<=0 returns the same object untouched', () => {
  const img = makeGradientImage(10, 10);
  const out = applyLocalContrast(img, 0);
  assert.equal(out, img);
});

test('applySharpen: amount<=0 returns the same object untouched', () => {
  const img = makeGradientImage(10, 10);
  const out = applySharpen(img, 0);
  assert.equal(out, img);
});

test('applySharpen: increases local contrast at an edge', () => {
  const img = makeSplitImage(40, 20, 80, 160);
  const sharpened = applySharpen({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }, 1.0);
  const y = 10, xLeft = 18, xRight = 21;
  const leftBefore = img.data[(y * 40 + xLeft) * 4];
  const rightBefore = img.data[(y * 40 + xRight) * 4];
  const leftAfter = sharpened.data[(y * 40 + xLeft) * 4];
  const rightAfter = sharpened.data[(y * 40 + xRight) * 4];
  assert.ok(rightAfter - leftAfter >= rightBefore - leftBefore, 'edge contrast should not decrease');
});

// ---------- align.js ----------
test('estimateShift: identical frames report zero shift, high confidence', () => {
  const img = makeGradientImage(120, 90);
  const { dx, dy, confidence } = estimateShift(img, img);
  assert.equal(dx, 0);
  assert.equal(dy, 0);
  assert.ok(confidence >= 0.6, `confidence=${confidence}`);
});

test('shiftImage: shifting then sampling matches the offset pixel (interior points)', () => {
  const img = makeGradientImage(50, 50);
  const shifted = shiftImage(img, 5, 0);
  const y = 25, x = 10;
  const got = shifted.data[(y * 50 + x) * 4];
  const expected = img.data[(y * 50 + (x + 5)) * 4];
  assert.equal(got, expected);
});

test('alignFrames: single frame returns unchanged with full confidence', () => {
  const img = makeGradientImage(20, 20);
  const { frames, confidence } = alignFrames([img]);
  assert.equal(frames.length, 1);
  assert.equal(confidence, 1);
});

// ---------- denoise.js ----------
test('denoise: strength<=0.02 returns the same object untouched', () => {
  const img = makeGradientImage(10, 10);
  const out = denoise(img, 0);
  assert.equal(out, img);
});

test('denoise: reduces variance in a noisy region while keeping the strong edge', () => {
  const img = makeCheckerWithNoise(60, 40, 7);
  const before = localVariance(img, 5, 25);
  const out = denoise({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }, 0.6);
  const after = localVariance(out, 5, 25);
  assert.ok(after < before, `variance before=${before.toFixed(1)} after=${after.toFixed(1)}`);

  const y = 20;
  const leftMean = out.data[(y * 60 + 5) * 4];
  const rightMean = out.data[(y * 60 + 55) * 4];
  assert.ok(Math.abs(rightMean - leftMean) > 60, `edge should survive denoise, diff=${Math.abs(rightMean - leftMean)}`);
});

// ---------- hdr.js ----------
test('fuseExposures: two identical frames reproduce the input closely', () => {
  const img = makeGradientImage(32, 32);
  const fused = fuseExposures([img, { data: new Uint8ClampedArray(img.data), width: 32, height: 32 }], analyzeImage(img));
  let maxDiff = 0;
  for (let i = 0; i < img.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(img.data[i] - fused.data[i]));
  assert.ok(maxDiff < 20, `maxDiff=${maxDiff}`);
});

test('fuseExposures: single frame falls back to pseudo-HDR tone mapping without crashing', () => {
  const img = makeGradientImage(20, 20);
  const out = fuseExposures([img], analyzeImage(img));
  assert.equal(out.width, 20);
  assert.equal(out.height, 20);
});

// ---------- night.js ----------
test('stackFrames: averaging brightens a dark burst and preserves dimensions', () => {
  const frames = [1, 2, 3].map(() => makeSolidImage(24, 24, 30, 30, 30));
  const analysis = analyzeImage(frames[0]);
  const out = stackFrames(frames, analysis);
  assert.equal(out.width, 24);
  assert.equal(out.height, 24);
  assert.ok(meanLumOf(out) > meanLumOf(frames[0]), 'night stack should brighten a dark scene');
});

// ---------- faceProtect.js ----------
test('buildFaceMask: no faces -> all-zero mask', () => {
  const mask = buildFaceMask(20, 20, []);
  assert.ok(mask.every((v) => v === 0));
});

test('buildFaceMask: face center is fully protected, far corners are not', () => {
  const mask = buildFaceMask(100, 100, [{ x: 30, y: 30, width: 40, height: 40 }]);
  const centerIdx = 50 * 100 + 50;
  const cornerIdx = 2 * 100 + 2;
  assert.ok(mask[centerIdx] > 0.9, `center=${mask[centerIdx]}`);
  assert.equal(mask[cornerIdx], 0);
});

// ---------- portrait.js ----------
test('applyPortraitBlur: runs without crashing and keeps dimensions', () => {
  const img = makeGradientImage(48, 32);
  const out = applyPortraitBlur(img, [{ x: 14, y: 4, width: 20, height: 20 }], null);
  assert.equal(out.width, 48);
  assert.equal(out.height, 32);
});

// ---------- document.js ----------
test('perspectiveCorrect: identity-ish quad reproduces the source image closely', () => {
  const img = makeGradientImage(60, 40);
  const quad = { tl: { x: 0, y: 0 }, tr: { x: 59, y: 0 }, br: { x: 59, y: 39 }, bl: { x: 0, y: 39 } };
  const out = perspectiveCorrect(img, quad, 60, 40);
  assert.equal(out.width, 60);
  assert.equal(out.height, 40);
  const y = 20, x = 30;
  const diff = Math.abs(out.data[(y * 60 + x) * 4] - img.data[(y * 60 + x) * 4]);
  assert.ok(diff < 15, `center pixel diff=${diff}`);
});

test('detectDocumentEdges: returns null on a flat, featureless image', () => {
  const img = makeSolidImage(100, 100, 128, 128, 128);
  const quad = detectDocumentEdges(img);
  assert.equal(quad, null);
});

test('detectDocumentEdges: finds a plausible quad for a high-contrast rectangle', () => {
  const img = makeSolidImage(120, 90, 30, 30, 30);
  for (let y = 15; y < 75; y++) {
    for (let x = 15; x < 105; x++) {
      const i = (y * 120 + x) * 4;
      img.data[i] = 230; img.data[i + 1] = 230; img.data[i + 2] = 230;
    }
  }
  const quad = detectDocumentEdges(img);
  assert.ok(quad !== null, 'expected a detected quad');
  assert.ok(quad.tl.x < 40 && quad.tl.y < 30, `tl=${JSON.stringify(quad.tl)}`);
  assert.ok(quad.br.x > 80 && quad.br.y > 60, `br=${JSON.stringify(quad.br)}`);
});

// ---------- pipeline.js ----------
await testAsync('runPipeline: single frame, low tier, completes and returns valid output', async () => {
  const img = makeGradientImage(200, 150);
  const { imageData, timings, stagesApplied } = await runPipeline([img], {
    mode: 'photo', quality: 'smart', deviceProfile: { tier: 'low' },
  });
  assert.ok(imageData.width > 0 && imageData.height > 0);
  assert.ok(stagesApplied.includes('tonemap'));
  assert.ok(!stagesApplied.includes('local-contrast'), 'low tier should skip local contrast');
  assert.ok(typeof timings.total === 'number');
});

await testAsync('runPipeline: multi-frame HDR mode on high tier fuses frames', async () => {
  const frames = [makeGradientImage(64, 48), makeGradientImage(64, 48), makeGradientImage(64, 48)];
  const { stagesApplied } = await runPipeline(frames, {
    mode: 'hdr', quality: 'hdr', deviceProfile: { tier: 'high' },
  });
  assert.ok(stagesApplied.includes('hdr-fuse'));
});

await testAsync('runPipeline: night mode stacks frames on mid/high tier', async () => {
  const frames = [1, 2, 3].map(() => makeSolidImage(48, 32, 25, 25, 25));
  const { stagesApplied } = await runPipeline(frames, {
    mode: 'night', quality: 'night', deviceProfile: { tier: 'mid' },
  });
  assert.ok(stagesApplied.includes('night-stack'));
});

await testAsync('runPipeline: portrait mode applies the blur stage', async () => {
  const img = makeGradientImage(80, 60);
  const { stagesApplied } = await runPipeline([img], {
    mode: 'portrait', quality: 'portrait', deviceProfile: { tier: 'mid' },
    faces: [{ x: 10, y: 5, width: 20, height: 20 }],
  });
  assert.ok(stagesApplied.includes('portrait-blur'));
});

await testAsync('runPipeline: document mode runs edge detection + enhancement', async () => {
  const img = makeSolidImage(120, 90, 30, 30, 30);
  for (let y = 15; y < 75; y++) {
    for (let x = 15; x < 105; x++) {
      const i = (y * 120 + x) * 4;
      img.data[i] = 220; img.data[i + 1] = 220; img.data[i + 2] = 220;
    }
  }
  const { stagesApplied } = await runPipeline([img], {
    mode: 'document', quality: 'natural', deviceProfile: { tier: 'mid' },
  });
  assert.ok(stagesApplied.includes('document-enhance'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
