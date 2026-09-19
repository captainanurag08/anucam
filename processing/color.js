/**
 * color.js — color science (spec section 18).
 *
 * Vibrance boosts under-saturated pixels more than already-saturated ones;
 * a flat saturation term adds a smaller uniform boost; both taper off near
 * luminance extremes (protects skies/blacks from crushing) and are damped
 * in a heuristic skin-tone hue band, further damped by an optional face
 * mask, to avoid the "excessive orange skin" failure mode called out in
 * the spec.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function applyColorGrading(img, params = {}, faceMask = null) {
  const { saturation = 0.08, vibrance = 0.12, warmth = 0 } = params;
  const { data, width, height } = img;
  const n = width * height;

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    let r = data[i], g = data[i + 1], b = data[i + 2];

    if (warmth !== 0) {
      r += warmth * 8;
      b -= warmth * 8;
    }

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2 / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    const hue = approxHue(r, g, b);

    const isSkinish = hue >= 5 && hue <= 45 && sat > 0.15 && sat < 0.75 && l > 0.2 && l < 0.85;
    let protection = isSkinish ? 0.45 : 0;
    if (faceMask) protection = Math.max(protection, faceMask[p] * 0.6);

    const extremesFade = 1 - Math.pow(Math.min(1, Math.abs(l - 0.5) * 2), 2);
    const vibAmount = vibrance * (1 - sat) * extremesFade * (1 - protection);
    const satAmount = saturation * extremesFade * (1 - protection * 0.7);
    const totalBoost = 1 + vibAmount + satAmount;

    const gray = LUM_R * r + LUM_G * g + LUM_B * b;
    data[i] = gray + (r - gray) * totalBoost;
    data[i + 1] = gray + (g - gray) * totalBoost;
    data[i + 2] = gray + (b - gray) * totalBoost;
  }
  return img;
}

function approxHue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}
