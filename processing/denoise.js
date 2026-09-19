/**
 * denoise.js — edge-aware noise reduction (spec section 15).
 *
 * A real bilateral filter: each output pixel is a weighted average of its
 * neighborhood, weighted by both spatial distance (a small Gaussian
 * kernel) and range/tonal distance (a Gaussian on luminance difference),
 * so it smooths flat regions while leaving real edges alone rather than
 * producing "plastic skin." Radius is kept to 1-2px so cost stays bounded;
 * pipeline.js is responsible for capping working resolution on weaker
 * devices before this runs.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function denoise(img, strength = 0.3) {
  if (strength <= 0.02) return img;
  const { data, width, height } = img;
  const radius = strength > 0.5 ? 2 : 1;
  const sigmaSpace = radius === 2 ? 1.6 : 1.0;
  const sigmaRange = 12 + strength * 55;

  const spatialW = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spatialW.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace)));
    }
  }

  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      if (x < radius || y < radius || x >= width - radius || y >= height - radius) {
        out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]; out[i + 3] = data[i + 3];
        continue;
      }

      const cr = data[i], cg = data[i + 1], cb = data[i + 2];
      const centerLum = LUM_R * cr + LUM_G * cg + LUM_B * cb;

      let wsum = 0, rsum = 0, gsum = 0, bsum = 0, k = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          const nr = data[ni], ng = data[ni + 1], nb = data[ni + 2];
          const nLum = LUM_R * nr + LUM_G * ng + LUM_B * nb;
          const rangeW = Math.exp(-((nLum - centerLum) ** 2) / (2 * sigmaRange * sigmaRange));
          const wgt = spatialW[k] * rangeW;
          wsum += wgt; rsum += nr * wgt; gsum += ng * wgt; bsum += nb * wgt;
          k++;
        }
      }

      out[i] = wsum > 0 ? rsum / wsum : cr;
      out[i + 1] = wsum > 0 ? gsum / wsum : cg;
      out[i + 2] = wsum > 0 ? bsum / wsum : cb;
      out[i + 3] = data[i + 3];
    }
  }
  return { data: out, width, height };
}
