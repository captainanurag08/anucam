/**
 * whiteBalance.js — automatic (gray-world) and manual-preset white balance.
 *
 * "Auto" estimates a neutral gray point from the image's average channel
 * values and applies a damped correction toward neutral (damped so a
 * genuinely warm/cool scene doesn't get flattened to gray). Manual presets
 * are fixed multipliers approximating standard light sources, per spec
 * section 17 — useful even though the camera track itself can't be told
 * to shoot in a specific white balance from the browser.
 */

const PRESETS = {
  daylight: [1.0, 1.0, 1.0],
  cloudy: [1.06, 1.0, 0.9],
  tungsten: [0.82, 1.0, 1.3],
  fluorescent: [0.92, 1.0, 1.14],
};

export function applyWhiteBalance(img, mode = 'auto', analysis = null) {
  const { data } = img;
  let rMul = 1, gMul = 1, bMul = 1;

  if (mode === 'auto') {
    const a = analysis || quickAverage(img);
    const gray = (a.avgR + a.avgG + a.avgB) / 3;
    if (gray > 1) {
      const damp = 0.55; // partial correction to avoid crushing intentional warmth
      rMul = 1 + (gray / Math.max(1, a.avgR) - 1) * damp;
      gMul = 1 + (gray / Math.max(1, a.avgG) - 1) * damp;
      bMul = 1 + (gray / Math.max(1, a.avgB) - 1) * damp;
    }
  } else if (PRESETS[mode]) {
    [rMul, gMul, bMul] = PRESETS[mode];
  }

  rMul = clamp(rMul, 0.6, 1.6);
  gMul = clamp(gMul, 0.6, 1.6);
  bMul = clamp(bMul, 0.6, 1.6);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] * rMul;
    data[i + 1] = data[i + 1] * gMul;
    data[i + 2] = data[i + 2] * bMul;
  }
  return img;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function quickAverage(img) {
  const { data } = img;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return { avgR: r / n, avgG: g / n, avgB: b / n };
}
