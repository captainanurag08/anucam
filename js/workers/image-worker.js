/**
 * image-worker.js — runs processing/pipeline.js off the main thread
 * (spec sections 32, 34). Frames arrive as ImageBitmaps (transferable,
 * cheap to move across the postMessage boundary), get converted to plain
 * {data,width,height} objects via OffscreenCanvas, processed, then the
 * result is transferred back as an ImageBitmap.
 *
 * Loaded as a module worker: `new Worker(url, { type: 'module' })`.
 * app.js wraps its construction in try/catch and falls back to running
 * the pipeline directly on the main thread if module workers aren't
 * supported (spec section 52's fallback hierarchy).
 */

import { runPipeline } from '../../processing/pipeline.js';

self.onmessage = async (event) => {
  const { id, type } = event.data;
  if (type !== 'process') return;

  try {
    const { bitmaps, options } = event.data;
    const frames = bitmaps.map(bitmapToImageDataLike);
    bitmaps.forEach((b) => b.close && b.close());

    const result = await runPipeline(frames, options);
    const outBitmap = imageDataLikeToBitmap(result.imageData);

    self.postMessage({
      id, type: 'result', ok: true,
      bitmap: outBitmap,
      timings: result.timings,
      analysis: summarizeAnalysis(result.analysis),
      stagesApplied: result.stagesApplied,
      tier: result.tier,
      preset: result.preset,
      width: result.imageData.width,
      height: result.imageData.height,
    }, [outBitmap]);
  } catch (err) {
    self.postMessage({ id, type: 'result', ok: false, error: String(err && err.message || err) });
  }
};

function bitmapToImageDataLike(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data: imgData.data, width: imgData.width, height: imgData.height };
}

function imageDataLikeToBitmap(img) {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const imgData = new ImageData(img.data, img.width, img.height);
  ctx.putImageData(imgData, 0, 0);
  return canvas.transferToImageBitmap();
}

function summarizeAnalysis(a) {
  if (!a) return null;
  const { histogram, ...rest } = a;
  return rest;
}
