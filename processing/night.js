/**
 * night.js — low-light / Night mode (spec section 16).
 *
 * Aligns the burst, averages the aligned frames (temporal averaging: noise
 * standard deviation falls roughly with sqrt(N) independent samples — the
 * denoise pass below is scaled down accordingly since the stack already
 * did much of the work), then brightens and recovers shadow/highlight
 * detail via the shared tone curve.
 */

import { alignFrames } from './align.js';
import { applyToneCurve } from './toneMap.js';
import { denoise } from './denoise.js';

export function stackFrames(frames, analysis) {
  const { frames: aligned, confidence } = alignFrames(frames);
  const useFrames = confidence > 0.25 ? aligned : [frames[0]];

  const { width, height } = useFrames[0];
  const n = width * height;
  const k = useFrames.length;
  const out = new Uint8ClampedArray(useFrames[0].data.length);

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    let r = 0, g = 0, b = 0;
    for (let f = 0; f < k; f++) {
      const d = useFrames[f].data;
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    out[i] = r / k; out[i + 1] = g / k; out[i + 2] = b / k; out[i + 3] = 255;
  }

  let stacked = { data: out, width, height };

  const noiseAfterStack = analysis ? analysis.noiseEstimate / Math.sqrt(k) : 0.2;
  stacked = denoise(stacked, Math.min(0.7, 0.25 + noiseAfterStack));

  stacked = applyToneCurve(stacked, {
    ev: 0.12,
    shadowLift: 0.3,
    highlightCompression: 0.25,
    contrast: 0.03,
  });

  return stacked;
}
