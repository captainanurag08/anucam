/**
 * controls.js — viewfinder overlay controls (spec sections 5-9).
 * Wires DOM controls to the CameraController and app state. Every control
 * here is feature-detected against camera.trackCapabilities and hidden
 * (not left dead) when the hardware/browser doesn't support it.
 */

import { showToast, vibrate } from './ui.js';

export function initControls(app) {
  initModeBar(app);
  initZoom(app);
  initFlash(app);
  initFocusExposure(app);
  initTimerGrid(app);
  initAspectRatio(app);
  initMoreSheet(app);
  initCameraSwitch(app);
}

function initModeBar(app) {
  const buttons = document.querySelectorAll('.mode-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'more') {
        document.getElementById('more-sheet').classList.add('sheet-open');
        return;
      }
      buttons.forEach((b) => b.classList.toggle('mode-btn-active', b === btn));
      app.setMode(mode);
    });
  });
}

function initZoom(app) {
  const zoomButtons = document.querySelectorAll('.zoom-btn');
  zoomButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const level = parseFloat(btn.dataset.zoom);
      await app.setZoom(level);
      zoomButtons.forEach((b) => b.classList.toggle('zoom-btn-active', b === btn));
    });
  });
}

export function updateZoomAvailability(cameraController) {
  const wrap = document.getElementById('zoom-controls');
  const caps = cameraController.trackCapabilities.zoom;
  if (!wrap) return;
  if (!caps) {
    wrap.classList.add('zoom-optical-only');
    wrap.querySelectorAll('.zoom-btn').forEach((b) => {
      const level = parseFloat(b.dataset.zoom);
      b.title = level === 1 ? '1x' : `${level}x (digital crop)`;
    });
  } else {
    wrap.classList.remove('zoom-optical-only');
    wrap.querySelectorAll('.zoom-btn').forEach((b) => {
      const level = parseFloat(b.dataset.zoom);
      b.disabled = level < caps.min || level > caps.max;
    });
  }
}

function initFlash(app) {
  const btn = document.getElementById('flash-btn');
  if (!btn) return;
  const states = ['off', 'auto', 'on'];
  btn.addEventListener('click', async () => {
    if (!app.camera.trackCapabilities.torch) {
      showToast('This camera has no flash/torch control.');
      return;
    }
    const idx = states.indexOf(app.state.flashMode);
    const next = states[(idx + 1) % states.length];
    app.state.flashMode = next;
    btn.dataset.flash = next;
    btn.setAttribute('aria-label', `Flash: ${next}`);
    if (next === 'on') await app.camera.applyTorch(true);
    else await app.camera.applyTorch(false);
  });
}

export function updateFlashAvailability(cameraController) {
  const btn = document.getElementById('flash-btn');
  if (!btn) return;
  btn.hidden = !cameraController.trackCapabilities.torch;
}

function initFocusExposure(app) {
  const viewfinder = document.getElementById('viewfinder-tap-layer');
  const ring = document.getElementById('focus-ring');
  const exposureSlider = document.getElementById('exposure-slider');

  if (viewfinder && ring) {
    viewfinder.addEventListener('click', async (e) => {
      const rect = viewfinder.getBoundingClientRect();
      const xNorm = (e.clientX - rect.left) / rect.width;
      const yNorm = (e.clientY - rect.top) / rect.height;

      ring.style.left = `${e.clientX - rect.left}px`;
      ring.style.top = `${e.clientY - rect.top}px`;
      ring.classList.remove('focus-ring-active');
      void ring.offsetWidth;
      ring.classList.add('focus-ring-active');

      const supported = await app.camera.applyFocusPoint(xNorm, yNorm);
      ring.classList.toggle('focus-ring-supported', supported);

      const exposureWrap = document.getElementById('exposure-wrap');
      if (exposureWrap && app.camera.trackCapabilities.exposureCompensation) {
        exposureWrap.classList.add('exposure-wrap-visible');
        clearTimeout(exposureWrap._hideTimer);
        exposureWrap._hideTimer = setTimeout(() => exposureWrap.classList.remove('exposure-wrap-visible'), 4000);
      }
    });
  }

  if (exposureSlider) {
    exposureSlider.addEventListener('input', async () => {
      const caps = app.camera.trackCapabilities.exposureCompensation;
      if (!caps) return;
      const t = parseFloat(exposureSlider.value); // -1..1
      const value = t >= 0 ? t * caps.max : t * -caps.min;
      await app.camera.applyExposureCompensation(value);
    });
  }
}

function initTimerGrid(app) {
  document.querySelectorAll('.timer-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timer-option').forEach((b) => b.classList.toggle('option-active', b === btn));
      app.setTimer(btn.dataset.timer);
    });
  });
  document.querySelectorAll('.grid-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.grid-option').forEach((b) => b.classList.toggle('option-active', b === btn));
      app.setGrid(btn.dataset.grid);
    });
  });
}

function initAspectRatio(app) {
  document.querySelectorAll('.aspect-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.aspect-option').forEach((b) => b.classList.toggle('option-active', b === btn));
      app.setAspectRatio(btn.dataset.aspect);
    });
  });
}

function initMoreSheet(app) {
  const sheet = document.getElementById('more-sheet');
  const closeBtn = document.getElementById('more-sheet-close');
  const backdrop = document.getElementById('more-sheet-backdrop');
  const closeSheet = () => sheet.classList.remove('sheet-open');
  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
  if (backdrop) backdrop.addEventListener('click', closeSheet);

  const docBtn = document.getElementById('document-mode-btn');
  if (docBtn) {
    docBtn.addEventListener('click', () => {
      closeSheet();
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('mode-btn-active'));
      app.setMode('document');
    });
  }

  document.querySelectorAll('.quality-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quality-option').forEach((b) => b.classList.toggle('option-active', b === btn));
      app.setQuality(btn.dataset.quality);
      vibrate(10);
    });
  });
}

function initCameraSwitch(app) {
  const btn = document.getElementById('switch-camera-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (app.state.isRecording) { showToast('Stop recording before switching cameras.'); return; }
    btn.classList.add('switch-camera-spinning');
    await app.switchCamera();
    setTimeout(() => btn.classList.remove('switch-camera-spinning'), 400);
  });
}

export function drawGrid(canvas, mode) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (mode === 'off') return;
  const divisions = mode === '4x4' ? 4 : 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < divisions; i++) {
    const x = (width / divisions) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    const y = (height / divisions) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}
