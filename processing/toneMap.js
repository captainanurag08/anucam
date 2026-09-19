/**
 * toneMap.js — smooth parametric tone curve (spec section 19).
 *
 * Builds a 256-entry LUT (black point clip -> shadow lift -> midtone
 * S-curve -> highlight roll-off) and applies it to per-pixel luminance,
 * then rescales R/G/B by the luminance ratio so hue and chroma are
 * preserved (a cheap, standard luma-preserving-color technique) instead
 * of the "brightness += 20; contrast += 30" approach the spec explicitly
 * warns against.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function applyToneCurve(img, params = {}) {
  const {
    blackPoint = 0.02,
    shadowLift = 0.08,
    highlightCompression = 0.15,
    contrast = 0.06,
    ev = 0,
  } = params;

  const { data } = img;
  const lut = buildToneLUT({ blackPoint, shadowLift, highlightCompression, contrast, ev });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lumIn = LUM_R * r + LUM_G * g + LUM_B * b;
    const lumOut = lut[Math.max(0, Math.min(255, Math.round(lumIn)))];
    const ratio = lumIn > 0.5 ? lumOut / lumIn : 1;
    data[i] = r * ratio;
    data[i + 1] = g * ratio;
    data[i + 2] = b * ratio;
  }
  return img;
}

function buildToneLUT({ blackPoint, shadowLift, highlightCompression, contrast, ev }) {
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    let x = v / 255 + ev;
    x = Math.max(0, x);

    x = x <= blackPoint ? 0 : (x - blackPoint) / (1 - blackPoint);

    const shadowWeight = Math.pow(1 - Math.min(1, x / 0.5), 1.5);
    x = x + shadowLift * shadowWeight * (1 - x);

    const s = x - 0.5;
    x = 0.5 + s * (1 + contrast) - contrast * 2 * s * s * s;

    if (x > 0.6) {
      const t = (x - 0.6) / 0.4;
      x = 0.6 + 0.4 * (1 - Math.pow(1 - t, 1 + highlightCompression * 4));
    }

    lut[v] = Math.max(0, Math.min(1, x)) * 255;
  }
  return lut;
}
