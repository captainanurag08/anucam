/**
 * resize.js — bilinear image resizing.
 *
 * Every processing module operates on plain {data, width, height} objects
 * (a Uint8ClampedArray of RGBA bytes plus dimensions) rather than requiring
 * the DOM ImageData class. This keeps the whole processing/ engine portable
 * between the main thread, a Web Worker, and Node (for the test suite),
 * since none of it touches document/window/canvas directly.
 */

export function resizeBilinear(img, newWidth, newHeight) {
  const { data, width, height } = img;
  newWidth = Math.max(1, Math.round(newWidth));
  newHeight = Math.max(1, Math.round(newHeight));

  if (newWidth === width && newHeight === height) {
    return { data: new Uint8ClampedArray(data), width, height };
  }

  const out = new Uint8ClampedArray(newWidth * newHeight * 4);
  const xRatio = width / newWidth;
  const yRatio = height / newHeight;

  for (let y = 0; y < newHeight; y++) {
    const srcY = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(srcY)));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, srcY - y0));

    for (let x = 0; x < newWidth; x++) {
      const srcX = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(srcX)));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, srcX - x0));

      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const oi = (y * newWidth + x) * 4;

      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c] * (1 - wx) + data[i10 + c] * wx;
        const bot = data[i01 + c] * (1 - wx) + data[i11 + c] * wx;
        out[oi + c] = top * (1 - wy) + bot * wy;
      }
    }
  }

  return { data: out, width: newWidth, height: newHeight };
}

/** Downscale so the long edge is at most maxLongEdge. No-op if already smaller. */
export function fitWithinLongEdge(img, maxLongEdge) {
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= maxLongEdge) return img;
  const scale = maxLongEdge / longEdge;
  return resizeBilinear(img, img.width * scale, img.height * scale);
}
