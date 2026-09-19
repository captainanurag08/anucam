/**
 * align.js — lightweight multi-frame alignment (spec sections 14/34).
 *
 * Full optical flow or feature matching is too expensive for a browser on
 * low/mid-end hardware. This estimates a single global (dx, dy) translation
 * per frame: downsample both frames to a small grayscale thumbnail, search
 * a small window of candidate shifts for the one minimizing sum-of-absolute
 * differences, then scale that shift back up and apply it to the
 * full-resolution frame with simple edge-clamped pixel shifting.
 *
 * This handles handshake between bursts well; it does not handle rotation,
 * parallax, or fast subject motion. When confidence is low, alignFrames()
 * falls back to the unshifted frame rather than risk ghosting.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function estimateShift(refImg, targetImg, maxShift = 24) {
  const searchSize = 96;
  const refSmall = toGraySmall(refImg, searchSize);
  const targetSmall = toGraySmall(targetImg, searchSize);
  const scale = searchSize / Math.max(refImg.width, refImg.height);
  const scaledMax = Math.max(2, Math.round(maxShift * scale));

  const w = refSmall.width, h = refSmall.height;
  const margin = scaledMax;

  let bestDx = 0, bestDy = 0, bestScore = Infinity;

  for (let dy = -scaledMax; dy <= scaledMax; dy++) {
    for (let dx = -scaledMax; dx <= scaledMax; dx++) {
      let sad = 0, count = 0;
      for (let y = margin; y < h - margin; y += 2) {
        for (let x = margin; x < w - margin; x += 2) {
          const a = refSmall.data[y * w + x];
          const b = targetSmall.data[(y + dy) * w + (x + dx)];
          sad += Math.abs(a - b);
          count++;
        }
      }
      const score = count ? sad / count : Infinity;
      // On a near-tie, prefer the smaller shift: a featureless region (sky, a
      // blank wall) can score equally well at many offsets, and the smallest
      // shift is the safer assumption rather than an arbitrary large one.
      const mag = Math.abs(dx) + Math.abs(dy);
      const bestMag = Math.abs(bestDx) + Math.abs(bestDy);
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && mag < bestMag)) {
        bestScore = score; bestDx = dx; bestDy = dy;
      }
    }
  }

  const confidence = bestScore < 12 ? 1 : bestScore < 25 ? 0.6 : 0.2;
  return {
    dx: Math.round(bestDx / scale),
    dy: Math.round(bestDy / scale),
    confidence,
  };
}

function toGraySmall(img, targetSize) {
  const { data, width, height } = img;
  const scale = targetSize / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.round(x / scale));
      const sy = Math.min(height - 1, Math.round(y / scale));
      const i = (sy * width + sx) * 4;
      out[y * w + x] = LUM_R * data[i] + LUM_G * data[i + 1] + LUM_B * data[i + 2];
    }
  }
  return { data: out, width: w, height: h };
}

/** Produces alignedTarget(x,y) = target(x+dx, y+dy), matching estimateShift's search. */
export function shiftImage(img, dx, dy) {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    const sy = clampInt(y + dy, 0, height - 1);
    for (let x = 0; x < width; x++) {
      const sx = clampInt(x + dx, 0, width - 1);
      const si = (sy * width + sx) * 4, di = (y * width + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width, height };
}

function clampInt(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function alignFrames(frames) {
  if (frames.length <= 1) return { frames: frames.slice(), confidence: 1 };
  const ref = frames[0];
  const aligned = [ref];
  let minConfidence = 1;
  for (let k = 1; k < frames.length; k++) {
    const { dx, dy, confidence } = estimateShift(ref, frames[k]);
    minConfidence = Math.min(minConfidence, confidence);
    aligned.push(confidence > 0.3 ? shiftImage(frames[k], dx, dy) : frames[k]);
  }
  return { frames: aligned, confidence: minConfidence };
}
