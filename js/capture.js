/**
 * capture.js — turning a live camera stream into pixel data (spec
 * sections 10, 13, 14, 16).
 *
 * Single-shot Photo mode uses ImageCapture.takePhoto() when available,
 * since it can return the sensor's true maximum photo resolution rather
 * than the (usually lower) streaming resolution. Multi-frame HDR/Night
 * bursts instead grab frames straight from the live <video> element in
 * fast succession: repeatedly calling takePhoto() re-triggers the
 * camera's own still-capture pipeline each time (slow, and each shot can
 * land moments apart, inviting motion mismatch between frames), while
 * grabbing from the streaming pipeline is fast and consistent — the same
 * reason real burst-capture implementations read from the preview
 * pipeline rather than the stills pipeline. A short spacing between Night
 * mode frames is kept deliberately (spec's "capture countdown") both to
 * encourage the user to hold still and to give auto-exposure a moment
 * between reads.
 */

function grabFrameFromVideo(videoEl, canvas) {
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!w || !h) throw new Error('Video has no dimensions yet');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function captureSinglePhoto(cameraController, canvas) {
  const { imageCapture } = cameraController;
  if (imageCapture) {
    try {
      const blob = await imageCapture.takePhoto();
      const bitmap = await createImageBitmap(blob);
      const imgData = bitmapToImageData(bitmap, canvas);
      bitmap.close && bitmap.close();
      return imgData;
    } catch (e) {
      // fall through to canvas capture
    }
  }
  return grabFrameFromVideo(cameraController.video, canvas);
}

function bitmapToImageData(bitmap, canvas) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function captureBurst(cameraController, canvas, count, spacingMs = 0) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push(grabFrameFromVideo(cameraController.video, canvas));
    if (spacingMs > 0 && i < count - 1) {
      await sleep(spacingMs);
    }
  }
  return frames;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every processing/*.js module deliberately works with plain
 * {data, width, height} objects rather than the DOM's ImageData class, so
 * the same code is portable between the main thread, a Worker, and plain
 * Node (for the automated tests) without needing a browser-only type.
 * Canvas APIs like putImageData(), however, strictly require a real
 * ImageData instance and throw a TypeError on a plain object of the exact
 * same shape. This is the one bridge function between the two worlds —
 * call it before handing pipeline output to any Canvas 2D API.
 */
export function toRealImageData(img) {
  if (typeof ImageData !== 'undefined' && img instanceof ImageData) return img;
  return new ImageData(img.data, img.width, img.height);
}

export function imageDataToBlob(imageData, canvas, mimeType = 'image/jpeg', quality = 0.92) {
  const real = toRealImageData(imageData);
  canvas.width = real.width;
  canvas.height = real.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(real, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}
