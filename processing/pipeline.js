/**
 * pipeline.js — orchestrates the full computational photography pipeline
 * (spec section 11):
 *
 *   capture -> analysis -> white balance -> HDR/night fusion -> denoise ->
 *   tone map -> local contrast -> color -> (portrait blur | document
 *   correction) -> sharpen -> output
 *
 * Every stage is gated by device tier and the active quality preset so it
 * degrades gracefully on weak hardware instead of crashing or stalling the
 * UI (spec sections 31-32, 53, 57). This module has no DOM dependency, so
 * it runs identically on the main thread (fallback path) or inside
 * image-worker.js (primary path).
 */

import { analyzeImage } from './analyzer.js';
import { computeExposureAdjustment } from './exposure.js';
import { applyWhiteBalance } from './whiteBalance.js';
import { alignFrames } from './align.js';
import { fuseExposures } from './hdr.js';
import { stackFrames } from './night.js';
import { denoise } from './denoise.js';
import { applyToneCurve } from './toneMap.js';
import { applyColorGrading } from './color.js';
import { applyLocalContrast } from './contrast.js';
import { applySharpen } from './sharpen.js';
import { buildFaceMask } from './faceProtect.js';
import { applyPortraitBlur } from './portrait.js';
import { detectDocumentEdges, perspectiveCorrect, enhanceDocument } from './document.js';
import { fitWithinLongEdge } from './resize.js';

const TIER_LONG_EDGE = { low: 1600, mid: 2400, high: 3600 };

export const QUALITY_PRESETS = {
  natural: { denoise: 0.15, toneStrength: 0.5, contrast: 0.08, saturation: 0.03, vibrance: 0.06, sharpen: 0.25 },
  smart: { denoise: 0.3, toneStrength: 1.0, contrast: 0.15, saturation: 0.08, vibrance: 0.12, sharpen: 0.4 },
  hdr: { denoise: 0.3, toneStrength: 1.3, contrast: 0.16, saturation: 0.07, vibrance: 0.1, sharpen: 0.35, forceMultiFrame: true },
  night: { denoise: 0.5, toneStrength: 1.2, contrast: 0.1, saturation: 0.06, vibrance: 0.08, sharpen: 0.25 },
  detail: { denoise: 0.2, toneStrength: 0.9, contrast: 0.22, saturation: 0.08, vibrance: 0.12, sharpen: 0.65 },
  portrait: { denoise: 0.3, toneStrength: 0.9, contrast: 0.14, saturation: 0.1, vibrance: 0.14, sharpen: 0.35 },
  max: { denoise: 0.35, toneStrength: 1.2, contrast: 0.2, saturation: 0.09, vibrance: 0.13, sharpen: 0.5, forceMultiFrame: true },
};

export async function runPipeline(frames, options = {}) {
  const timings = {};
  const t0 = now();

  const tier = (options.deviceProfile && options.deviceProfile.tier) || 'mid';
  const preset = QUALITY_PRESETS[options.quality] || QUALITY_PRESETS.smart;
  const mode = options.mode || 'photo';

  const longEdgeCap = TIER_LONG_EDGE[tier] || TIER_LONG_EDGE.mid;
  const working = frames.map((f) => fitWithinLongEdge(f, longEdgeCap));
  timings.prepare = elapsed(t0);

  let t = now();
  const analysis = analyzeImage(working[0]);
  timings.analysis = elapsed(t);

  const stagesApplied = [];
  let result;

  t = now();
  if (mode === 'night' && working.length > 1 && tier !== 'low') {
    result = stackFrames(working, analysis);
    stagesApplied.push('night-stack');
  } else if ((mode === 'hdr' || preset.forceMultiFrame) && working.length > 1 && tier !== 'low') {
    const { frames: aligned } = alignFrames(working);
    result = fuseExposures(aligned, analysis);
    stagesApplied.push('hdr-fuse');
  } else if (mode === 'hdr') {
    result = fuseExposures([working[0]], analysis);
    stagesApplied.push('pseudo-hdr');
  } else {
    result = working[0];
  }
  timings.fusion = elapsed(t);

  t = now();
  const exposureParams = computeExposureAdjustment(analysis);
  result = applyWhiteBalance(result, options.whiteBalanceMode || 'auto', analysis);
  timings.whiteBalance = elapsed(t);

  t = now();
  if (preset.denoise > 0 && tier !== 'low') {
    result = denoise(result, Math.min(0.8, preset.denoise + analysis.noiseEstimate * 0.4));
    stagesApplied.push('denoise');
  } else if (analysis.noiseEstimate > 0.5) {
    result = denoise(result, 0.2);
    stagesApplied.push('denoise-light');
  }
  timings.denoise = elapsed(t);

  t = now();
  result = applyToneCurve(result, {
    ev: exposureParams.ev * preset.toneStrength,
    shadowLift: exposureParams.shadowLift * preset.toneStrength,
    highlightCompression: exposureParams.highlightCompression * preset.toneStrength,
    contrast: preset.contrast,
  });
  stagesApplied.push('tonemap');
  timings.toneMap = elapsed(t);

  t = now();
  if (tier !== 'low') {
    result = applyLocalContrast(result, preset.contrast * 0.6);
    stagesApplied.push('local-contrast');
  }
  timings.localContrast = elapsed(t);

  let faceMask = null;
  const scaledFaces = options.faces && options.faces.length ? scaleFaces(options.faces, frames[0], result) : [];
  if (scaledFaces.length) {
    faceMask = buildFaceMask(result.width, result.height, scaledFaces);
  }

  t = now();
  result = applyColorGrading(result, { saturation: preset.saturation, vibrance: preset.vibrance }, faceMask);
  stagesApplied.push('color');
  timings.color = elapsed(t);

  if (mode === 'portrait') {
    t = now();
    const focus = options.focusPoint && frames[0]
      ? { x: options.focusPoint.x * (result.width / frames[0].width), y: options.focusPoint.y * (result.height / frames[0].height) }
      : null;
    result = applyPortraitBlur(result, scaledFaces, focus);
    stagesApplied.push('portrait-blur');
    timings.portrait = elapsed(t);
  }

  if (mode === 'document') {
    t = now();
    const quad = detectDocumentEdges(result);
    if (quad) {
      result = perspectiveCorrect(result, quad);
      stagesApplied.push('perspective-correct');
    }
    result = enhanceDocument(result);
    stagesApplied.push('document-enhance');
    timings.document = elapsed(t);
  }

  t = now();
  result = applySharpen(result, preset.sharpen, faceMask && mode !== 'document' ? faceMask : null);
  stagesApplied.push('sharpen');
  timings.sharpen = elapsed(t);

  timings.total = elapsed(t0);

  return { imageData: result, timings, analysis, stagesApplied, tier, preset: options.quality || 'smart' };
}

function scaleFaces(faces, fromImg, toImg) {
  if (!faces || !fromImg) return faces || [];
  const sx = toImg.width / fromImg.width, sy = toImg.height / fromImg.height;
  return faces.map((f) => ({ x: f.x * sx, y: f.y * sy, width: f.width * sx, height: f.height * sy }));
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function elapsed(t0) {
  return Math.round((now() - t0) * 10) / 10;
}
