/**
 * faceProtect.js — face-aware protection (spec section 22).
 *
 * detectFaces() is the one function in the whole processing/ engine that
 * touches a browser API directly (the Shape Detection API's FaceDetector).
 * It is fully feature-detected and wrapped in try/catch: when unsupported
 * or when detection fails for any reason, it resolves to an empty array
 * and the rest of the pipeline falls back to generic edge-aware processing
 * automatically (sharpen.js/color.js simply get an empty/null mask). No
 * cloud API is used or required.
 *
 * buildFaceMask() is pure and portable: given face rectangles, it builds a
 * soft (feathered) per-pixel protection mask.
 */

export async function detectFaces(source) {
  if (typeof FaceDetector === 'undefined') return [];
  try {
    const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
    const faces = await detector.detect(source);
    return faces.map((f) => ({
      x: f.boundingBox.x, y: f.boundingBox.y,
      width: f.boundingBox.width, height: f.boundingBox.height,
    }));
  } catch (e) {
    return [];
  }
}

export function buildFaceMask(width, height, faces) {
  const mask = new Float32Array(width * height);
  if (!faces || faces.length === 0) return mask;

  for (const face of faces) {
    const cx = face.x + face.width / 2;
    const cy = face.y + face.height / 2;
    const rx = Math.max(1, face.width * 0.75);
    const ry = Math.max(1, face.height * 0.8);

    const x0 = Math.max(0, Math.floor(cx - rx * 1.3));
    const x1 = Math.min(width, Math.ceil(cx + rx * 1.3));
    const y0 = Math.max(0, Math.floor(cy - ry * 1.3));
    const y1 = Math.min(height, Math.ceil(cy + ry * 1.3));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const nx = (x - cx) / rx, ny = (y - cy) / ry;
        const d = Math.sqrt(nx * nx + ny * ny);
        const v = d <= 1 ? 1 : Math.max(0, 1 - (d - 1) / 0.6);
        const p = y * width + x;
        if (v > mask[p]) mask[p] = v;
      }
    }
  }
  return mask;
}
