/**
 * contrast.js — local contrast / micro-contrast (spec section 20).
 *
 * A true large-radius Gaussian blur is expensive per pixel. Downscaling
 * the image sharply and then upscaling it back approximates a large-radius
 * low-pass filter cheaply (the upscale interpolation does the smoothing).
 * Subtracting that low-frequency base from the original gives a detail
 * layer; adding a fraction of it back is a standard unsharp-mask-style
 * local contrast boost.
 */

import { resizeBilinear } from './resize.js';

export function applyLocalContrast(img, amount = 0.15) {
  if (amount <= 0) return img;
  const { data, width, height } = img;

  const smallW = Math.max(8, Math.round(width / 16));
  const smallH = Math.max(8, Math.round(height / 16));
  const small = resizeBilinear(img, smallW, smallH);
  const blurred = resizeBilinear(small, width, height);

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const orig = data[i + c];
      const low = blurred.data[i + c];
      out[i + c] = orig + (orig - low) * amount;
    }
    out[i + 3] = data[i + 3];
  }
  return { data: out, width, height };
}
