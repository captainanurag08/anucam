/**
 * document.js — document mode (spec section 26).
 *
 * detectDocumentEdges(): downscale -> grayscale -> Sobel gradient magnitude
 * -> Otsu threshold to isolate the strongest edges, then find the 4 extreme
 * corners of the surviving edge pixels via the standard sum/difference
 * trick (top-left minimizes x+y, bottom-right maximizes x+y, top-right
 * maximizes x-y, bottom-left minimizes x-y). This works well for a
 * document against a reasonably contrasting background; it is not a full
 * contour/quadrilateral fit and can be thrown off by cluttered scenes,
 * which is why it returns null (skip correction) when too few strong edge
 * pixels are found or the resulting quad is implausibly small.
 *
 * perspectiveCorrect(): solves a planar homography from 4 point
 * correspondences via direct linear transform (an 8x8 linear system, Gauss-
 * Jordan elimination with partial pivoting) mapping output-rectangle
 * coordinates back into the source image, then inverse-warps with
 * bilinear sampling. This is standard, well-established linear algebra
 * (the same math behind e.g. OpenCV's getPerspectiveTransform), not any
 * proprietary technique.
 */

export function detectDocumentEdges(img) {
  const { width, height } = img;
  const small = toGrayscaleDownscaled(img, 300);
  const edges = sobelMagnitude(small);
  const threshold = otsuThreshold(edges);

  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  let pTL = null, pBR = null, pTR = null, pBL = null, count = 0;

  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      if (edges.data[y * small.width + x] <= threshold) continue;
      count++;
      const s = x + y, d = x - y;
      if (s < minSum) { minSum = s; pTL = { x, y }; }
      if (s > maxSum) { maxSum = s; pBR = { x, y }; }
      if (d < minDiff) { minDiff = d; pBL = { x, y }; }
      if (d > maxDiff) { maxDiff = d; pTR = { x, y }; }
    }
  }

  if (count < small.width * small.height * 0.01 || !pTL || !pBR || !pTR || !pBL) return null;

  const scaleX = width / small.width, scaleY = height / small.height;
  const toFull = (p) => ({ x: p.x * scaleX, y: p.y * scaleY });
  const quad = { tl: toFull(pTL), tr: toFull(pTR), br: toFull(pBR), bl: toFull(pBL) };

  if (quadArea(quad) < width * height * 0.08) return null;
  return quad;
}

function quadArea(q) {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % 4];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a / 2);
}

function toGrayscaleDownscaled(img, maxDim) {
  const { data, width, height } = img;
  const scale = maxDim / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.round(x / scale)), sy = Math.min(height - 1, Math.round(y / scale));
      const i = (sy * width + sx) * 4;
      out[y * w + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
  }
  return { data: out, width: w, height: h };
}

function sobelMagnitude(gray) {
  const { data, width, height } = gray;
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx = data[(y - 1) * width + x + 1] + 2 * data[y * width + x + 1] + data[(y + 1) * width + x + 1]
               - data[(y - 1) * width + x - 1] - 2 * data[y * width + x - 1] - data[(y + 1) * width + x - 1];
      const gy = data[(y + 1) * width + x - 1] + 2 * data[(y + 1) * width + x] + data[(y + 1) * width + x + 1]
               - data[(y - 1) * width + x - 1] - 2 * data[(y - 1) * width + x] - data[(y - 1) * width + x + 1];
      out[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { data: out, width, height };
}

function otsuThreshold(gradImg) {
  const { data } = gradImg;
  let max = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  if (max === 0) return 0;

  const bins = 64;
  const hist = new Array(bins).fill(0);
  for (let i = 0; i < data.length; i++) hist[Math.min(bins - 1, Math.floor((data[i] / max) * bins))]++;

  const total = data.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, maxVar = 0, threshBin = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) { maxVar = varBetween; threshBin = i; }
  }
  return (threshBin / bins) * max;
}

export function perspectiveCorrect(img, quad, outWidth, outHeight) {
  const w = Math.max(1, Math.round(outWidth || Math.max(dist(quad.tl, quad.tr), dist(quad.bl, quad.br))));
  const h = Math.max(1, Math.round(outHeight || Math.max(dist(quad.tl, quad.bl), dist(quad.tr, quad.br))));

  const H = computeHomography(
    [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    [quad.tl, quad.tr, quad.br, quad.bl]
  );

  const { data, width, height } = img;
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = applyHomography(H, x, y);
      const oi = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) { out[oi + 3] = 0; continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const i00 = (y0 * width + x0) * 4 + c, i10 = (y0 * width + x0 + 1) * 4 + c;
        const i01 = ((y0 + 1) * width + x0) * 4 + c, i11 = ((y0 + 1) * width + x0 + 1) * 4 + c;
        const top = data[i00] * (1 - fx) + data[i10] * fx;
        const bot = data[i01] * (1 - fx) + data[i11] * fx;
        out[oi + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { data: out, width: w, height: h };
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function computeHomography(src, dst) {
  const A = [], bVec = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); bVec.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); bVec.push(dy);
  }
  const h = solveLinearSystem(A, bVec);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyHomography(H, x, y) {
  const denom = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / denom, (H[3] * x + H[4] * y + H[5]) / denom];
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col] || 1e-9;
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

export function enhanceDocument(img) {
  const { data } = img;
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    let gray = 0;
    for (let c = 0; c < 3; c++) {
      data[i + c] = ((data[i + c] - min) / range) * 255;
      gray += data[i + c];
    }
    gray /= 3;
    for (let c = 0; c < 3; c++) {
      const desat = gray + (data[i + c] - gray) * 0.7;
      data[i + c] = 128 + (desat - 128) * 1.12;
    }
  }
  return img;
}
