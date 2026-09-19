/**
 * hdr.js — browser-feasible HDR (spec section 13).
 *
 * When multiple frames are available, this is a single-scale simplification
 * of Mertens/Kautz/Van Reeth exposure fusion: each frame gets a per-pixel
 * weight from well-exposedness x saturation x local contrast, weights are
 * normalized across frames and lightly blurred (to reduce seams), then
 * frames are blended by those weights. This is deliberately NOT full
 * Laplacian-pyramid fusion (which would give sharper multi-scale blending
 * but costs much more to compute) — a documented, honest simplification
 * rather than a claim of the full algorithm.
 *
 * When only one frame is available (low-end tier, or a static subject that
 * skipped burst capture), falls back to a single-frame tone-mapping pass
 * with stronger shadow recovery / highlight compression, per spec: "For
 * weak devices: Use single-frame HDR/tone mapping."
 */

import { applyToneCurve } from './toneMap.js';

export function fuseExposures(frames, analysis) {
  if (frames.length < 2) {
    return pseudoHDRSingleFrame(frames[0], analysis);
  }

  const { width, height } = frames[0];
  const n = width * height;
  const weights = frames.map((f) => computeWeightMap(f));
  weights.forEach((w) => smoothWeightMap(w, width, height));

  const out = new Uint8ClampedArray(frames[0].data.length);
  for (let p = 0; p < n; p++) {
    let wsum = 0;
    for (let k = 0; k < frames.length; k++) wsum += weights[k][p];
    if (wsum < 1e-4) {
      for (let k = 0; k < frames.length; k++) weights[k][p] = 1 / frames.length;
      wsum = 1;
    }
    const i = p * 4;
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < frames.length; k++) {
      const w = weights[k][p] / wsum;
      const d = frames[k].data;
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w;
    }
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
  }
  return { data: out, width, height };
}

function computeWeightMap(img) {
  const { data, width, height } = img;
  const n = width * height;
  const w = new Float32Array(n);

  const lumAt = (p) => 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;

    const we = gauss(r, 0.5, 0.2) * gauss(g, 0.5, 0.2) * gauss(b, 0.5, 0.2);

    const mean = (r + g + b) / 3;
    const sat = Math.sqrt(((r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2) / 3);

    let contrastW = 0.5;
    const x = p % width, y = (p / width) | 0;
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
      const lap = Math.abs(4 * lumAt(p) - lumAt(p - 1) - lumAt(p + 1) - lumAt(p - width) - lumAt(p + width)) / 255;
      contrastW = 0.2 + lap;
    }

    w[p] = we * Math.pow(sat + 0.05, 0.3) * Math.pow(contrastW, 0.5);
  }
  return w;
}

function gauss(x, mean, sigma) {
  return Math.exp(-((x - mean) ** 2) / (2 * sigma * sigma));
}

function smoothWeightMap(w, width, height) {
  const tmp = new Float32Array(w.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const l = x > 0 ? w[p - 1] : w[p], r = x < width - 1 ? w[p + 1] : w[p];
      tmp[p] = (l + w[p] + r) / 3;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const t = y > 0 ? tmp[p - width] : tmp[p], b = y < height - 1 ? tmp[p + width] : tmp[p];
      w[p] = (t + tmp[p] + b) / 3;
    }
  }
}

function pseudoHDRSingleFrame(img, analysis) {
  const out = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  const shadowClip = analysis ? analysis.shadowClipping : 0.05;
  const highClip = analysis ? analysis.highlightClipping : 0.05;
  return applyToneCurve(out, {
    shadowLift: 0.18 + shadowClip * 2,
    highlightCompression: 0.3 + highClip * 3,
    contrast: 0.04,
    ev: 0,
  });
}
