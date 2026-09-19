/**
 * capabilities.js — device/browser capability profiling (spec section 31).
 *
 * Runs before camera permission is requested, so the UI can hide/disable
 * unsupported controls immediately. Track-level capabilities (actual torch/
 * zoom/focus support, which depend on the specific camera hardware) are
 * determined separately once a stream exists — see camera.js.
 */

export async function detectCapabilities() {
  const supportsWebGL = detectWebGL();
  const supportsWebAssembly = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  const supportsWorkers = typeof Worker !== 'undefined';
  const supportsOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const supportsImageCaptureAPI = typeof ImageCapture !== 'undefined';
  const supportsFaceDetector = typeof FaceDetector !== 'undefined';
  const supportsMediaRecorder = typeof MediaRecorder !== 'undefined';
  const supportsShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare;
  const supportsIndexedDB = typeof indexedDB !== 'undefined';

  const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || null;
  const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || null;
  const screenLongEdge = typeof screen !== 'undefined' ? Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1) : 1080;

  const tier = estimateTier({ deviceMemory, hardwareConcurrency, supportsWebGL, supportsOffscreenCanvas, screenLongEdge });

  return {
    tier,
    deviceMemory,
    hardwareConcurrency,
    screenLongEdge,
    supportsWebGL,
    supportsWebAssembly,
    supportsWorkers,
    supportsOffscreenCanvas,
    supportsImageCaptureAPI,
    supportsFaceDetector,
    supportsMediaRecorder,
    supportsShareFiles,
    supportsIndexedDB,
    prefersReducedMotion: typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  };
}

function estimateTier({ deviceMemory, hardwareConcurrency, supportsWebGL, supportsOffscreenCanvas, screenLongEdge }) {
  let score = 0;

  if (deviceMemory != null) {
    if (deviceMemory >= 6) score += 2;
    else if (deviceMemory >= 4) score += 1;
    else score -= 1;
  } else {
    score += 0.5; // unknown: assume mid, do not over-penalize
  }

  if (hardwareConcurrency != null) {
    if (hardwareConcurrency >= 8) score += 2;
    else if (hardwareConcurrency >= 4) score += 1;
    else score -= 1;
  } else {
    score += 0.5;
  }

  if (supportsWebGL) score += 1;
  if (supportsOffscreenCanvas) score += 1;
  if (screenLongEdge >= 2400) score += 1;

  if (score >= 4.5) return 'high';
  if (score >= 2) return 'mid';
  return 'low';
}

function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (e) {
    return false;
  }
}
