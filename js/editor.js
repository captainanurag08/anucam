/**
 * editor.js — post-capture photo editor (spec section 29).
 *
 * Every slider maps to a real parameter in the processing/ modules, not a
 * cosmetic CSS filter: brightness/highlights/shadows/contrast go through
 * toneMap.js, saturation through color.js, temperature through a
 * whiteBalance-style channel shift, sharpness through sharpen.js, noise
 * reduction through denoise.js. Sliders are re-applied from a single
 * unedited base image on every change (not accumulated in place), so
 * dragging a slider back to 0 always exactly restores that stage's
 * contribution.
 *
 * For interactivity, live preview runs on a downscaled copy; Save re-runs
 * the same parameter stack against the full-resolution original.
 */

import { applyToneCurve } from '../processing/toneMap.js';
import { applyColorGrading } from '../processing/color.js';
import { applySharpen } from '../processing/sharpen.js';
import { denoise } from '../processing/denoise.js';
import { fitWithinLongEdge } from '../processing/resize.js';
import { getMedia, saveMedia, generateId } from './storage.js';
import { imageDataToBlob } from './capture.js';
import { showToast, switchScreen } from './ui.js';

const PREVIEW_MAX_EDGE = 900;
const NEUTRAL = { brightness: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0, sharpness: 0.2, noise: 0 };

const state = {
  mediaId: null,
  sourceBitmap: null, // full-resolution ImageBitmap of the (possibly auto-enhanced) base
  fullBaseImage: null, // {data,width,height} full-res base, recomputed lazily on save
  previewBase: null, // {data,width,height} downscaled base used for live preview
  rotation: 0, // 0/90/180/270
  crop: null, // {x,y,w,h} normalized 0..1, or null for full frame
  params: { ...NEUTRAL },
  originalBlobForCompare: null,
};

let scratchCanvas = null;
function getScratchCanvas() {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
  return scratchCanvas;
}

export async function openEditor(mediaId) {
  const item = await getMedia(mediaId);
  if (!item) { showToast('Could not load that photo.'); return; }
  if (item.type === 'video') { showToast('Video editing is not supported yet.'); return; }

  state.mediaId = mediaId;
  state.rotation = 0;
  state.crop = null;
  state.params = { ...NEUTRAL };
  state.originalBlobForCompare = item.originalBlob || item.blob;

  const sourceBlob = item.originalBlob || item.blob;
  const bitmap = await createImageBitmap(sourceBlob);
  state.sourceBitmap = bitmap;
  state.fullBaseImage = null; // computed on demand from sourceBitmap + rotation/crop

  const canvas = getScratchCanvas();
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const full = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  state.previewBase = fitWithinLongEdge({ data: new Uint8ClampedArray(full.data), width: full.width, height: full.height }, PREVIEW_MAX_EDGE);

  resetSliderInputs();
  switchScreen('editor');
  renderPreview();
}

function resetSliderInputs() {
  Object.entries(state.params).forEach(([key, value]) => {
    const el = document.getElementById(`slider-${key}`);
    if (el) el.value = String(value);
  });
}

export function initEditorControls() {
  ['brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'sharpness', 'noise'].forEach((key) => {
    const el = document.getElementById(`slider-${key}`);
    if (!el) return;
    el.addEventListener('input', () => {
      state.params[key] = parseFloat(el.value);
      renderPreview();
    });
  });

  const autoBtn = document.getElementById('editor-auto-enhance-btn');
  if (autoBtn) autoBtn.addEventListener('click', autoEnhance);

  const rotateBtn = document.getElementById('editor-rotate-btn');
  if (rotateBtn) rotateBtn.addEventListener('click', rotate90);

  const saveBtn = document.getElementById('editor-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveEdits);

  const resetBtn = document.getElementById('editor-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    state.params = { ...NEUTRAL };
    state.rotation = 0;
    resetSliderInputs();
    renderPreview();
  });

  initCropUI();
  initCompareHold();
}

function computeParams() {
  const p = state.params;
  return {
    tone: {
      ev: p.brightness * 0.25,
      shadowLift: Math.max(0, p.shadows) * 0.4 + Math.max(0, -p.highlights) * 0.1,
      highlightCompression: Math.max(0, p.highlights) * 0.5 + Math.max(0, -p.shadows) * 0.05,
      contrast: p.contrast * 0.25,
    },
    color: { saturation: p.saturation * 0.5, vibrance: p.saturation * 0.3 },
    warmth: p.temperature,
    sharpen: Math.max(0, p.sharpness),
    denoise: Math.max(0, p.noise),
  };
}

function applyEditStack(baseImg) {
  let img = { data: new Uint8ClampedArray(baseImg.data), width: baseImg.width, height: baseImg.height };
  const params = computeParams();

  if (params.warmth !== 0) {
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i] + params.warmth * 12;
      img.data[i + 2] = img.data[i + 2] - params.warmth * 12;
    }
  }
  if (params.denoise > 0.02) img = denoise(img, Math.min(0.8, params.denoise));
  img = applyToneCurve(img, params.tone);
  img = applyColorGrading(img, params.color);
  if (params.sharpen > 0) img = applySharpen(img, params.sharpen);
  return img;
}

function renderPreview() {
  const rotated = rotateImageData(state.previewBase, state.rotation);
  const edited = applyEditStack(rotated);
  const canvas = document.getElementById('editor-canvas');
  canvas.width = edited.width;
  canvas.height = edited.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(edited.data, edited.width, edited.height), 0, 0);
}

function rotateImageData(img, degrees) {
  if (degrees % 360 === 0) return img;
  const canvas = getScratchCanvas();
  const swap = degrees === 90 || degrees === 270;
  canvas.width = swap ? img.height : img.width;
  canvas.height = swap ? img.width : img.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  const tmp = document.createElement('canvas');
  tmp.width = img.width; tmp.height = img.height;
  tmp.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  ctx.drawImage(tmp, -img.width / 2, -img.height / 2);
  ctx.restore();
  const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: new Uint8ClampedArray(out.data), width: out.width, height: out.height };
}

function rotate90() {
  state.rotation = (state.rotation + 90) % 360;
  renderPreview();
}

async function autoEnhance() {
  showToast('Enhancing…');
  const { runPipeline } = await import('../processing/pipeline.js');
  const { detectCapabilities } = await import('./capabilities.js');
  const deviceProfile = await detectCapabilities();

  const canvas = getScratchCanvas();
  canvas.width = state.sourceBitmap.width;
  canvas.height = state.sourceBitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(state.sourceBitmap, 0, 0);
  const full = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const { imageData } = await runPipeline([{ data: full.data, width: full.width, height: full.height }], {
    mode: 'photo', quality: 'smart', deviceProfile,
  });

  const preview = fitWithinLongEdge({ data: new Uint8ClampedArray(imageData.data), width: imageData.width, height: imageData.height }, PREVIEW_MAX_EDGE);
  state.previewBase = preview;
  state.fullBaseImage = imageData; // cache the full-res enhanced base for saving
  state.params = { ...NEUTRAL };
  resetSliderInputs();
  renderPreview();
  showToast('Enhanced.');
}

function initCropUI() {
  const toggleBtn = document.getElementById('editor-crop-toggle-btn');
  const overlay = document.getElementById('editor-crop-overlay');
  const rectEl = document.getElementById('crop-rect');
  const applyBtn = document.getElementById('editor-crop-apply-btn');
  const cancelBtn = document.getElementById('editor-crop-cancel-btn');
  if (!toggleBtn || !overlay || !rectEl) return;

  let rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

  const paint = () => {
    rectEl.style.left = `${rect.x * 100}%`;
    rectEl.style.top = `${rect.y * 100}%`;
    rectEl.style.width = `${rect.w * 100}%`;
    rectEl.style.height = `${rect.h * 100}%`;
  };

  toggleBtn.addEventListener('click', () => {
    overlay.classList.add('crop-overlay-active');
    paint();
  });
  cancelBtn.addEventListener('click', () => overlay.classList.remove('crop-overlay-active'));
  applyBtn.addEventListener('click', () => {
    state.crop = { ...rect };
    overlay.classList.remove('crop-overlay-active');
    applyCropToPreview();
  });

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function attachDrag(el, onDelta) {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, startY = e.clientY;
      const overlayRect = overlay.getBoundingClientRect();
      const startRect = { ...rect };
      const move = (ev) => {
        const dx = (ev.clientX - startX) / overlayRect.width;
        const dy = (ev.clientY - startY) / overlayRect.height;
        onDelta(dx, dy, startRect);
        paint();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  attachDrag(rectEl, (dx, dy, start) => {
    rect.x = clamp01(start.x + dx);
    rect.y = clamp01(start.y + dy);
    rect.w = Math.min(rect.w, 1 - rect.x);
    rect.h = Math.min(rect.h, 1 - rect.y);
  });

  overlay.querySelectorAll('.crop-handle').forEach((handle) => {
    attachDrag(handle, (dx, dy, start) => {
      const corner = handle.dataset.handle;
      if (corner.includes('n')) { rect.y = clamp01(start.y + dy); rect.h = start.y + start.h - rect.y; }
      if (corner.includes('s')) { rect.h = clamp01(start.h + dy); }
      if (corner.includes('w')) { rect.x = clamp01(start.x + dx); rect.w = start.x + start.w - rect.x; }
      if (corner.includes('e')) { rect.w = clamp01(start.w + dx); }
      rect.w = Math.max(0.1, Math.min(rect.w, 1 - rect.x));
      rect.h = Math.max(0.1, Math.min(rect.h, 1 - rect.y));
    });
  });
}

function applyCropToPreview() {
  if (!state.crop) return;
  const rotated = rotateImageData(state.previewBase, state.rotation);
  state.previewBase = cropImageData(rotated, state.crop);
  state.rotation = 0; // rotation is now baked into previewBase
  state.crop = null;
  renderPreview();
}

function cropImageData(img, rect) {
  const x0 = Math.round(rect.x * img.width), y0 = Math.round(rect.y * img.height);
  const w = Math.max(1, Math.round(rect.w * img.width)), h = Math.max(1, Math.round(rect.h * img.height));
  const canvas = getScratchCanvas();
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const cropped = canvas.getContext('2d').getImageData(x0, y0, w, h);
  return { data: new Uint8ClampedArray(cropped.data), width: w, height: h };
}

function initCompareHold() {
  const btn = document.getElementById('editor-compare-hold-btn');
  const canvas = document.getElementById('editor-canvas');
  const originalCanvas = document.getElementById('editor-original-canvas');
  if (!btn || !canvas || !originalCanvas) return;

  const showOriginal = () => {
    const rotated = rotateImageData(state.previewBase, 0);
    originalCanvas.width = rotated.width;
    originalCanvas.height = rotated.height;
    originalCanvas.getContext('2d').putImageData(new ImageData(rotated.data, rotated.width, rotated.height), 0, 0);
    originalCanvas.hidden = false;
  };
  const hideOriginal = () => { originalCanvas.hidden = true; };

  btn.addEventListener('pointerdown', showOriginal);
  btn.addEventListener('pointerup', hideOriginal);
  btn.addEventListener('pointerleave', hideOriginal);
}

async function saveEdits() {
  showToast('Saving…');
  const canvas = getScratchCanvas();
  canvas.width = state.sourceBitmap.width;
  canvas.height = state.sourceBitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(state.sourceBitmap, 0, 0);
  const full = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let fullImg = state.fullBaseImage || { data: new Uint8ClampedArray(full.data), width: full.width, height: full.height };

  if (state.rotation % 360 !== 0) fullImg = rotateImageData(fullImg, state.rotation);
  if (state.crop) fullImg = cropImageData(fullImg, state.crop);

  const finalImg = applyEditStack(fullImg);
  const outCanvas = document.createElement('canvas');
  const blob = await imageDataToBlob(new ImageData(finalImg.data, finalImg.width, finalImg.height), outCanvas, 'image/jpeg', 0.92);
  const thumbBlob = await makeThumbnail(finalImg);

  const existing = await getMedia(state.mediaId);
  const record = {
    id: generateId(),
    type: 'photo',
    blob,
    thumbnailBlob: thumbBlob,
    originalBlob: existing ? existing.originalBlob || existing.blob : null,
    mode: existing ? existing.mode : 'photo',
    width: finalImg.width,
    height: finalImg.height,
    createdAt: Date.now(),
    sizeBytes: blob.size,
    enhanced: true,
    editedFrom: state.mediaId,
  };
  await saveMedia(record);
  showToast('Saved to gallery.');
}

async function makeThumbnail(img) {
  const small = fitWithinLongEdge(img, 400);
  const canvas = document.createElement('canvas');
  return imageDataToBlob(new ImageData(small.data, small.width, small.height), canvas, 'image/jpeg', 0.8);
}

export function getEditorState() {
  return state;
}
