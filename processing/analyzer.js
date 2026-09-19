/**
 * analyzer.js — pre-processing image analysis.
 *
 * Computes the statistics the rest of the pipeline uses to decide how hard
 * to push each stage (section 12 of the spec): a brightness histogram,
 * highlight/shadow clipping, contrast, a coarse noise estimate, average
 * saturation, a rough color-temperature proxy, and edge density.
 *
 * Noise and edge density are both derived from local pixel differences —
 * a genuinely lightweight proxy, not a true wavelet-subband noise estimator
 * or a full Canny edge map. That trade-off is intentional: this needs to
 * run on every capture, including on low-end devices.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function analyzeImage(img) {
  const { data, width, height } = img;
  const pixelCount = width * height;
  const histogram = new Uint32Array(256);

  let sumLum = 0, sumR = 0, sumG = 0, sumB = 0, sumSat = 0;
  let highlightClipped = 0, shadowClipped = 0, sampled = 0;

  // Sample every pixel up to ~4MP; beyond that, stride to stay O(N) but bounded.
  const stride = pixelCount > 4_000_000 ? 2 : 1;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = LUM_R * r + LUM_G * g + LUM_B * b;

      histogram[Math.max(0, Math.min(255, Math.round(lum)))]++;
      sumLum += lum;
      sumR += r; sumG += g; sumB += b;
      if (lum > 250) highlightClipped++;
      if (lum < 5) shadowClipped++;

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      sumSat += max === 0 ? 0 : (max - min) / max;
      sampled++;
    }
  }

  const meanLuminance = sumLum / sampled / 255;
  const avgR = sumR / sampled, avgG = sumG / sampled, avgB = sumB / sampled;

  let variance = 0;
  const meanByte = meanLuminance * 255;
  for (let v = 0; v < 256; v++) {
    variance += histogram[v] * (v - meanByte) * (v - meanByte);
  }
  variance /= sampled;
  const contrast = Math.sqrt(variance) / 255;

  // Edge density: gradients sampled on a coarse grid scaled to image size.
  const edgeStride = Math.max(stride, Math.floor(Math.min(width, height) / 200) || 1);
  let edgeSum = 0, edgeSamples = 0;
  for (let y = edgeStride; y < height - edgeStride; y += edgeStride) {
    for (let x = edgeStride; x < width - edgeStride; x += edgeStride) {
      const l = lumAt(data, width, x, y);
      const gx = lumAt(data, width, x + edgeStride, y) - lumAt(data, width, x - edgeStride, y);
      const gy = lumAt(data, width, x, y + edgeStride) - lumAt(data, width, x, y - edgeStride);
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      edgeSamples++;
      void l;
    }
  }
  const edgeDensity = edgeSamples ? (edgeSum / edgeSamples) / 255 : 0;

  // Noise proxy: fine pixel-to-pixel luminance differences (high-frequency energy).
  const nStride = Math.max(1, stride) * 3;
  let noiseSum = 0, noiseSamples = 0;
  for (let y = 1; y < height - 1; y += nStride) {
    for (let x = 1; x < width - 1; x += nStride) {
      const l = lumAt(data, width, x, y);
      const lr = lumAt(data, width, x + 1, y);
      const lb = lumAt(data, width, x, y + 1);
      noiseSum += Math.abs(l - lr) + Math.abs(l - lb);
      noiseSamples++;
    }
  }
  const noiseEstimate = noiseSamples ? Math.min(1, (noiseSum / noiseSamples) / 40) : 0;

  const colorTemperature = avgB < 1 ? 1 : avgR / avgB;

  return {
    width, height, histogram,
    meanLuminance,
    highlightClipping: highlightClipped / sampled,
    shadowClipping: shadowClipped / sampled,
    contrast,
    noiseEstimate,
    saturation: sumSat / sampled,
    colorTemperature,
    edgeDensity,
    avgR, avgG, avgB,
  };
}

function lumAt(data, width, x, y) {
  const i = (y * width + x) * 4;
  return LUM_R * data[i] + LUM_G * data[i + 1] + LUM_B * data[i + 2];
}
