/**
 * sharpen.js — adaptive sharpening (spec section 21).
 *
 * Image -> edge detection -> edge mask -> controlled sharpening -> blend.
 * A 4-neighbor Laplacian provides the high-pass sharpening signal; its
 * strength is gated by local edge magnitude (so flat skies, smooth skin,
 * and dark noise get little to no sharpening) and by an optional
 * protect mask (from face detection) to keep skin soft.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function applySharpen(img, amount = 0.4, protectMask = null) {
  if (amount <= 0) return img;
  const { data, width, height } = img;
  const n = width * height;
  const out = new Uint8ClampedArray(data.length);

  const lum = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    lum[p] = LUM_R * data[i] + LUM_G * data[i + 1] + LUM_B * data[i + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;

      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) {
        out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]; out[i + 3] = data[i + 3];
        continue;
      }

      const l = lum[p];
      const lL = lum[p - 1], lR = lum[p + 1], lT = lum[p - width], lB = lum[p + width];
      const highPass = l * 4 - lL - lR - lT - lB;

      const gx = lR - lL, gy = lB - lT;
      const edgeMag = Math.sqrt(gx * gx + gy * gy) / 255;
      const edgeMask = Math.min(1, edgeMag * 3);
      const flatnessPenalty = edgeMag < 0.01 ? 0.15 : 1;

      let strength = amount * edgeMask * flatnessPenalty;
      if (protectMask) strength *= 1 - protectMask[p] * 0.85;

      const addend = highPass * strength * 0.5;
      out[i] = data[i] + addend;
      out[i + 1] = data[i + 1] + addend;
      out[i + 2] = data[i + 2] + addend;
      out[i + 3] = data[i + 3];
    }
  }
  return { data: out, width, height };
}
