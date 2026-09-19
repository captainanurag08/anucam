/**
 * portrait.js — computational portrait blur (spec section 24).
 *
 * There is no depth sensor or ML segmentation model available offline
 * without a heavy dependency, so this is an honest approximation, not
 * true subject segmentation: a soft mask anchored to detected face(s)
 * (extended downward to roughly cover shoulders/torso) or, if no face was
 * found, to the user's tapped focus point. The mask is feathered so blur
 * increases gradually with distance from the subject rather than producing
 * a hard cutout, and two blur strengths are blended by that same falloff
 * so the effect deepens further into the background. The UI is
 * responsible for labeling this as "computational blur" to the user.
 */

import { buildFaceMask } from './faceProtect.js';
import { resizeBilinear } from './resize.js';

export function applyPortraitBlur(img, faces, focusPoint) {
  const { data, width, height } = img;

  let sharpMask;
  if (faces && faces.length > 0) {
    sharpMask = buildFaceMask(width, height, faces);
    extendMaskDownward(sharpMask, width, height, faces);
  } else {
    sharpMask = radialMaskFromPoint(width, height, focusPoint || { x: width / 2, y: height / 2 });
  }
  smoothMaskEdges(sharpMask, width, height, 12);

  const soft = resizeBilinear(boxBlur(resizeBilinear(img, Math.max(4, (width / 10) | 0), Math.max(4, (height / 10) | 0)), 2), width, height);
  const heavy = resizeBilinear(boxBlur(resizeBilinear(img, Math.max(4, (width / 24) | 0), Math.max(4, (height / 24) | 0)), 2), width, height);

  const out = new Uint8ClampedArray(data.length);
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const focus = sharpMask[p];
    const bg = 1 - focus;
    for (let c = 0; c < 3; c++) {
      const bgBlend = soft.data[i + c] * (1 - bg) + heavy.data[i + c] * bg;
      out[i + c] = data[i + c] * focus + bgBlend * (1 - focus);
    }
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

function radialMaskFromPoint(width, height, point) {
  const mask = new Float32Array(width * height);
  const r = Math.min(width, height) * 0.28;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - point.x, dy = y - point.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      mask[y * width + x] = d <= r ? 1 : Math.max(0, 1 - (d - r) / (r * 1.5));
    }
  }
  return mask;
}

function extendMaskDownward(mask, width, height, faces) {
  for (const face of faces) {
    const cx = face.x + face.width / 2;
    const topY = face.y + face.height * 0.7;
    const bottomY = Math.min(height, face.y + face.height * 3.2);
    const rx = face.width * 1.4;
    for (let y = topY; y < bottomY; y++) {
      const t = (y - topY) / Math.max(1, bottomY - topY);
      const widen = rx * (1 + t * 0.6);
      const x0 = Math.max(0, Math.floor(cx - widen)), x1 = Math.min(width, Math.ceil(cx + widen));
      const fall = Math.max(0, 1 - t * 0.9);
      const row = Math.floor(y) * width;
      for (let x = x0; x < x1; x++) {
        const p = row + x;
        if (fall > mask[p]) mask[p] = fall;
      }
    }
  }
}

function smoothMaskEdges(mask, width, height, radius) {
  boxBlur1D(mask, width, height, radius, true);
  boxBlur1D(mask, width, height, radius, false);
}

function boxBlur1D(mask, width, height, radius, horizontal) {
  const copy = mask.slice();
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, c = 0;
        for (let d = -radius; d <= radius; d++) {
          const xx = x + d;
          if (xx >= 0 && xx < width) { sum += copy[y * width + xx]; c++; }
        }
        mask[y * width + x] = sum / c;
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, c = 0;
        for (let d = -radius; d <= radius; d++) {
          const yy = y + d;
          if (yy >= 0 && yy < height) { sum += copy[yy * width + x]; c++; }
        }
        mask[y * width + x] = sum / c;
      }
    }
  }
}

function boxBlur(img, radius) {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
            const i = (yy * width + xx) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
          }
        }
      }
      const i = (y * width + x) * 4;
      out[i] = r / c; out[i + 1] = g / c; out[i + 2] = b / c; out[i + 3] = data[i + 3];
    }
  }
  return { data: out, width, height };
}
