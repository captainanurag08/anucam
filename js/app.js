/**
 * app.js — application bootstrap and orchestration (spec sections 1-4,
 * 31, 52, 58). This is the only module allowed to know about all the
 * others; camera/capture/processing/storage/UI stay decoupled from each
 * other and only meet here.
 */

import { detectCapabilities } from './capabilities.js';
import { CameraController } from './camera.js';
import { requestCameraStream, queryCameraPermissionState, isSecureContext, CameraError } from './permissions.js';
import { captureSinglePhoto, captureBurst, imageDataToBlob, toRealImageData } from './capture.js';
import { initControls, updateZoomAvailability, updateFlashAvailability, drawGrid } from './controls.js';
import { saveMedia, generateId, clearAllMedia, estimateStorageUsage } from './storage.js';
import { openGallery, closeViewer, deleteCurrentViewerItem, shareCurrentViewerItem, downloadCurrentViewerItem, refreshGalleryThumb, getCurrentViewerId } from './gallery.js';
import { openEditor, initEditorControls } from './editor.js';
import { getSettings, initSettingsScreen, updateSetting } from './settings.js';
import { showToast, switchScreen, playShutterAnimation, vibrate, runCountdown, formatBytes } from './ui.js';
import { fitWithinLongEdge } from '../processing/resize.js';

const BURST_COUNTS = { hdr: 3, night: 4, max: 3 };

class App {
  constructor() {
    this.state = {
      mode: 'photo',
      quality: getSettings().processingPreset,
      flashMode: 'off',
      timer: getSettings().timer,
      grid: getSettings().grid,
      aspectRatio: getSettings().aspectRatio,
      zoomLevel: 1,
      isRecording: false,
      focusPoint: null,
      performanceMode: getSettings().performanceMode,
    };
    this.deviceProfile = null;
    this.camera = null;
    this.worker = null;
    this.workerAvailable = false;
    this._pendingWorkerRequests = new Map();
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.canvas = document.getElementById('capture-canvas');
    this.faceDetectTimer = null;
    this.lastFaces = [];
  }

  async init() {
    this.deviceProfile = await detectCapabilities();
    document.body.dataset.tier = this.deviceProfile.tier;
    if (this.deviceProfile.prefersReducedMotion) document.body.classList.add('reduced-motion');

    this._setupWorker();
    this._wireStaticUI();

    if (!isSecureContext()) {
      this._showPermissionScreen('Camera access requires HTTPS (or localhost). Serve this app over a secure connection and reload.', false);
      return;
    }

    const state = await queryCameraPermissionState();
    if (state === 'denied') {
      this._showPermissionScreen('Camera access is currently blocked for this site. Open your browser settings to allow it, then reload.', true);
      return;
    }

    await this.startCamera();
  }

  _setupWorker() {
    try {
      this.worker = new Worker(new URL('./workers/image-worker.js', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event) => {
        const pending = this._pendingWorkerRequests.get(event.data.id);
        if (!pending) return; // no longer awaited (e.g. already timed out) — ignore
        this._pendingWorkerRequests.delete(event.data.id);
        clearTimeout(pending.timeoutId);
        if (!event.data.ok) { pending.reject(new Error(event.data.error || 'Worker reported an unknown error')); return; }
        pending.resolve(event.data);
      };

      this.worker.onerror = (event) => {
        console.error('Worker crashed:', event.message || event);
        this.workerAvailable = false;
        this._rejectAllPendingWorkerRequests(new Error(`Worker crashed: ${event.message || 'unknown error'}`));
      };

      this.workerAvailable = true;
    } catch (e) {
      this.workerAvailable = false;
    }
  }

  _rejectAllPendingWorkerRequests(err) {
    for (const pending of this._pendingWorkerRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(err);
    }
    this._pendingWorkerRequests.clear();
  }

  _wireStaticUI() {
    initControls(this);
    initEditorControls();
    initSettingsScreen(this);
    this.applyMirrorPreference();
    this.setGrid(this.state.grid, { silent: true });
    this.setAspectRatio(this.state.aspectRatio, { silent: true });
    this.setDebugMode(getSettings().debugMode);

    document.getElementById('shutter-btn').addEventListener('click', () => this.onShutterPress());
    document.getElementById('gallery-thumb').addEventListener('click', () => openGallery());
    document.getElementById('gallery-back-btn').addEventListener('click', () => switchScreen('camera'));
    document.getElementById('settings-btn').addEventListener('click', () => switchScreen('settings'));
    document.getElementById('settings-back-btn').addEventListener('click', () => switchScreen('camera'));
    document.getElementById('editor-back-btn').addEventListener('click', () => switchScreen('camera'));

    document.getElementById('viewer-close-btn').addEventListener('click', closeViewer);
    document.getElementById('viewer-delete-btn').addEventListener('click', deleteCurrentViewerItem);
    document.getElementById('viewer-share-btn').addEventListener('click', shareCurrentViewerItem);
    document.getElementById('viewer-download-btn').addEventListener('click', downloadCurrentViewerItem);
    document.getElementById('viewer-edit-btn').addEventListener('click', () => {
      const id = getCurrentViewerId();
      closeViewer();
      if (id) openEditor(id);
    });

    window.addEventListener('resize', () => this._resizeGridCanvas());

    document.getElementById('permission-request-btn').addEventListener('click', () => this.startCamera());

    this._updateStorageInfo();
  }

  _showPermissionScreen(message, showButton) {
    switchScreen('permission');
    document.getElementById('permission-message').textContent = message;
    document.getElementById('permission-request-btn').hidden = !showButton;
  }

  async startCamera() {
    try {
      this.camera = new CameraController(document.getElementById('viewfinder'), this.deviceProfile);
      await this.camera.init(getSettings().defaultCamera === 'user' ? 'user' : 'environment');
      switchScreen('camera');
      updateZoomAvailability(this.camera);
      updateFlashAvailability(this.camera);
      this.applyMirrorPreference();
      this._resizeGridCanvas();
      this._updateDebugStaticInfo();
      this._startFaceDetectionLoop();
    } catch (err) {
      const message = err instanceof CameraError ? err.message : 'Could not access the camera.';
      this._showPermissionScreen(message, err instanceof CameraError && err.code === 'denied');
    }
  }

  async switchCamera() {
    if (!this.camera) return;
    await this.camera.switchCamera();
    updateZoomAvailability(this.camera);
    updateFlashAvailability(this.camera);
    this.applyMirrorPreference();
  }

  applyMirrorPreference() {
    const video = document.getElementById('viewfinder');
    if (!video || !this.camera) return;
    const shouldMirror = this.camera.facingMode === 'user' && getSettings().mirrorFrontCamera;
    video.classList.toggle('mirrored', shouldMirror);
  }

  setMode(mode) {
    this.state.mode = mode;
    document.getElementById('screen-camera').dataset.mode = mode;
    const isVideo = mode === 'video';
    document.getElementById('shutter-btn').classList.toggle('shutter-btn-video', isVideo);
  }

  setQuality(quality) { this.state.quality = quality; }
  setTimer(timer) { this.state.timer = timer; }
  setPerformanceMode(mode) { this.state.performanceMode = mode; }

  setGrid(grid, opts = {}) {
    this.state.grid = grid;
    this._resizeGridCanvas();
    if (!opts.silent) updateSetting('grid', grid);
  }

  setAspectRatio(ratio, opts = {}) {
    this.state.aspectRatio = ratio;
    const stage = document.getElementById('viewfinder-stage');
    stage.dataset.aspect = ratio;
    if (!opts.silent) updateSetting('aspectRatio', ratio);
  }

  async setZoom(level) {
    this.state.zoomLevel = level;
    const applied = this.camera ? await this.camera.applyZoom(level) : false;
    if (!applied) {
      document.getElementById('viewfinder').style.transform = `scale(${level}) ${this.camera && this.camera.facingMode === 'user' && getSettings().mirrorFrontCamera ? 'scaleX(-1)' : ''}`;
    } else {
      document.getElementById('viewfinder').style.transform = '';
    }
  }

  setDebugMode(on) {
    document.getElementById('debug-panel').hidden = !on;
    if (on) this._updateDebugStaticInfo();
  }

  _resizeGridCanvas() {
    const canvas = document.getElementById('grid-overlay');
    const stage = document.getElementById('viewfinder-stage');
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    drawGrid(canvas, this.state.grid);
  }

  async _startFaceDetectionLoop() {
    if (!this.deviceProfile.supportsFaceDetector) return;
    const { detectFaces } = await import('../processing/faceProtect.js');
    const loop = async () => {
      if (this.camera && this.camera.video.readyState >= 2 && (this.state.mode === 'portrait')) {
        try { this.lastFaces = await detectFaces(this.camera.video); } catch (e) { this.lastFaces = []; }
      }
      this.faceDetectTimer = setTimeout(loop, 900);
    };
    loop();
  }

  async onShutterPress() {
    if (this.state.mode === 'video') { await this._toggleVideoRecording(); return; }
    if (this.state.isCapturing) return;
    this.state.isCapturing = true;
    document.getElementById('shutter-btn').classList.add('shutter-busy');

    try {
      if (this.state.timer !== 'off') {
        await runCountdown(parseInt(this.state.timer, 10));
      }
      await this._captureAndProcess();
    } catch (err) {
      console.error(err);
      const reason = err && err.message ? err.message : 'unknown error';
      showToast(`Capture failed: ${reason}`, 4200);
    } finally {
      this.state.isCapturing = false;
      document.getElementById('shutter-btn').classList.remove('shutter-busy');
    }
  }

  async _captureAndProcess() {
    const t0 = performance.now();
    if (getSettings().shutterSound) this._playShutterSound();
    playShutterAnimation();
    vibrate(15);

    const mode = this.state.mode;
    const wantsBurst = mode === 'hdr' || mode === 'night' || (BURST_COUNTS[this.state.quality] && (mode === 'photo'));
    let frames;

    if (mode === 'night') {
      frames = await captureBurst(this.camera, this.canvas, BURST_COUNTS.night, 220);
    } else if (mode === 'hdr' || (this.state.quality === 'hdr' && this._effectiveTier() !== 'low')) {
      frames = await captureBurst(this.camera, this.canvas, BURST_COUNTS.hdr, 40);
    } else {
      frames = [await captureSinglePhoto(this.camera, this.canvas)];
    }

    frames = frames.map((f) => this._cropToAspect(f, this.state.aspectRatio));
    const captureMs = Math.round(performance.now() - t0);

    const originalBlob = getSettings().saveOriginal ? await imageDataToBlob(frames[0], document.createElement('canvas')) : null;

    const options = {
      mode,
      quality: this.state.quality,
      deviceProfile: { ...this.deviceProfile, tier: this._effectiveTier() },
      whiteBalanceMode: getSettings().whiteBalance,
      faces: mode === 'portrait' ? this.lastFaces : [],
      focusPoint: this.state.focusPoint,
    };

    document.getElementById('processing-indicator').classList.add('processing-active');
    let result;
    try {
      result = await this._runPipelineSmart(frames, options);
    } finally {
      document.getElementById('processing-indicator').classList.remove('processing-active');
    }

    const exportT0 = performance.now();
    const canvas = document.createElement('canvas');
    const enhancedBlob = await imageDataToBlob(result.imageData, canvas, 'image/jpeg', 0.92);
    const thumbCanvas = document.createElement('canvas');
    const thumbSmall = fitWithinLongEdge(result.imageData, 400);
    const thumbBlob = await imageDataToBlob(thumbSmall, thumbCanvas, 'image/jpeg', 0.8);
    const exportMs = Math.round(performance.now() - exportT0);

    await saveMedia({
      id: generateId(),
      type: 'photo',
      blob: enhancedBlob,
      thumbnailBlob: thumbBlob,
      originalBlob,
      mode,
      width: result.imageData.width,
      height: result.imageData.height,
      createdAt: Date.now(),
      sizeBytes: enhancedBlob.size,
      enhanced: true,
    });

    await refreshGalleryThumb();
    this._updateStorageInfo();
    this._updateDebugTimings({ ...result.timings, capture: captureMs, export: exportMs, total: Math.round(performance.now() - t0) }, result);
    showToast(`Saved · enhanced in ${((result.timings.total || 0) / 1000).toFixed(1)}s`);
  }

  _cropToAspect(imageData, ratio) {
    if (ratio === 'full') return imageData;
    const targets = { '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1 };
    const target = targets[ratio];
    if (!target) return imageData;

    const { width, height } = imageData;
    const currentRatio = width / height;
    let cropW = width, cropH = height;
    if (currentRatio > target) cropW = Math.round(height * target);
    else cropH = Math.round(width / target);
    const x0 = Math.floor((width - cropW) / 2), y0 = Math.floor((height - cropH) / 2);

    const canvas = this.canvas;
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(toRealImageData(imageData), 0, 0);
    return canvas.getContext('2d').getImageData(x0, y0, cropW, cropH);
  }

  _effectiveTier() {
    if (this.state.performanceMode === 'battery') return 'low';
    if (this.state.performanceMode === 'performance') return this.deviceProfile.tier === 'low' ? 'mid' : 'high';
    return this.deviceProfile.tier;
  }

  async _runPipelineSmart(frames, options) {
    if (this.workerAvailable) {
      try {
        return await this._runInWorker(frames, options);
      } catch (e) {
        console.warn('Worker processing failed, falling back to main thread:', e);
      }
    }
    const { runPipeline } = await import('../processing/pipeline.js');
    const plainFrames = frames.map((f) => ({ data: f.data, width: f.width, height: f.height }));
    return runPipeline(plainFrames, options);
  }

  async _runInWorker(frames, options) {
    const bitmaps = await Promise.all(frames.map((f) => createImageBitmap(f)));
    const id = generateId();

    const raw = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pendingWorkerRequests.delete(id);
        reject(new Error('Worker did not respond within 15s (it may have failed to load)'));
      }, 15000);

      this._pendingWorkerRequests.set(id, { resolve, reject, timeoutId });

      try {
        this.worker.postMessage({ id, type: 'process', bitmaps, options }, bitmaps);
      } catch (err) {
        this._pendingWorkerRequests.delete(id);
        clearTimeout(timeoutId);
        reject(err);
      }
    });

    const canvas = document.createElement('canvas');
    canvas.width = raw.width; canvas.height = raw.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(raw.bitmap, 0, 0);
    raw.bitmap.close && raw.bitmap.close();
    const imageData = ctx.getImageData(0, 0, raw.width, raw.height);
    return {
      imageData, timings: raw.timings, analysis: raw.analysis,
      stagesApplied: raw.stagesApplied, tier: raw.tier, preset: raw.preset,
    };
  }

  _playShutterSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch (e) { /* audio not available; silently skip */ }
  }

  async _toggleVideoRecording() {
    if (!this.state.isRecording) await this._startRecording();
    else await this._stopRecording();
  }

  async _startRecording() {
    if (!this.camera || !this.camera.stream) return;
    if (typeof MediaRecorder === 'undefined') { showToast('Video recording is not supported in this browser.'); return; }

    const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';

    this.recordedChunks = [];
    try {
      this.mediaRecorder = new MediaRecorder(this.camera.stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      showToast('Could not start recording.');
      return;
    }
    this.mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) this.recordedChunks.push(e.data); };
    this.mediaRecorder.onstop = () => this._onRecordingStopped(mimeType || 'video/webm');

    this.mediaRecorder.start();
    this.state.isRecording = true;
    this._recordStart = Date.now();
    document.getElementById('video-record-indicator').classList.add('recording-active');
    document.getElementById('shutter-btn').classList.add('shutter-recording');
    document.getElementById('switch-camera-btn').disabled = true;
    this._recordTimerInterval = setInterval(() => this._updateRecordTimer(), 250);
  }

  async _stopRecording() {
    if (!this.mediaRecorder) return;
    this.mediaRecorder.stop();
    this.state.isRecording = false;
    clearInterval(this._recordTimerInterval);
    document.getElementById('video-record-indicator').classList.remove('recording-active');
    document.getElementById('shutter-btn').classList.remove('shutter-recording');
    document.getElementById('switch-camera-btn').disabled = false;
  }

  _updateRecordTimer() {
    const el = document.getElementById('video-timer');
    if (!el) return;
    const s = Math.floor((Date.now() - this._recordStart) / 1000);
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  async _onRecordingStopped(mimeType) {
    const blob = new Blob(this.recordedChunks, { type: mimeType.split(';')[0] });
    const durationMs = Date.now() - this._recordStart;
    const { width, height } = this.camera.getVideoNativeSize();
    const id = generateId();

    await saveMedia({
      id,
      type: 'video',
      blob,
      thumbnailBlob: null, // filled in moments later by _generateVideoThumbnail() below via updateMedia()
      mode: 'video',
      width, height,
      createdAt: Date.now(),
      sizeBytes: blob.size,
      durationMs,
    });

    await this._generateVideoThumbnail(id, blob);
    await refreshGalleryThumb();
    this._updateStorageInfo();
    showToast('Video saved.');
  }

  async _generateVideoThumbnail(id, blob) {
    try {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(blob);
      video.muted = true;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      await new Promise((resolve) => { video.onseeked = resolve; });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const thumbBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
      URL.revokeObjectURL(video.src);

      const { updateMedia } = await import('./storage.js');
      if (thumbBlob) {
        await updateMedia(id, { thumbnailBlob: thumbBlob });
        await refreshGalleryThumb();
      }
    } catch (e) {
      // Thumbnail generation is best-effort; the video itself is already saved.
    }
  }

  async clearGalleryStorage() {
    await clearAllMedia();
    await refreshGalleryThumb();
    this._updateStorageInfo();
    showToast('Gallery cleared.');
  }

  async _updateStorageInfo() {
    const { usage, quota } = await estimateStorageUsage();
    const el = document.getElementById('setting-storage-usage');
    if (el) el.textContent = usage != null ? `${formatBytes(usage)} used${quota ? ` of ${formatBytes(quota)}` : ''}` : 'Unavailable';
  }

  _updateDebugStaticInfo() {
    const panel = document.getElementById('debug-panel');
    if (panel.hidden) return;
    const c = this.camera;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('debug-tier', this.deviceProfile.tier);
    set('debug-webgl', this.deviceProfile.supportsWebGL ? 'yes' : 'no');
    set('debug-wasm', this.deviceProfile.supportsWebAssembly ? 'yes (unused by design — see README)' : 'no');
    set('debug-worker', this.workerAvailable ? 'active' : 'main-thread fallback');
    set('debug-imagecapture', c && c.imageCapture ? 'yes' : 'no');
    set('debug-torch', c && c.trackCapabilities.torch ? 'yes' : 'no');
    set('debug-zoom', c && c.trackCapabilities.zoom ? `yes (${c.trackCapabilities.zoom.min}-${c.trackCapabilities.zoom.max})` : 'no');
    set('debug-focus', c && c.trackCapabilities.pointsOfInterest ? 'yes' : 'no');
    set('debug-exposure', c && c.trackCapabilities.exposureCompensation ? 'yes' : 'no');
    set('debug-resolution', c ? `${c.getVideoNativeSize().width}x${c.getVideoNativeSize().height}` : '-');
    set('debug-browser', navigator.userAgent.slice(0, 60));
  }

  _updateDebugTimings(timings, result) {
    const panel = document.getElementById('debug-panel');
    if (panel.hidden) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('debug-t-capture', `${timings.capture ?? '-'} ms`);
    set('debug-t-analysis', `${timings.analysis ?? '-'} ms`);
    set('debug-t-fusion', `${timings.fusion ?? '-'} ms`);
    set('debug-t-denoise', `${timings.denoise ?? '-'} ms`);
    set('debug-t-tonemap', `${timings.toneMap ?? '-'} ms`);
    set('debug-t-sharpen', `${timings.sharpen ?? '-'} ms`);
    set('debug-t-export', `${timings.export ?? '-'} ms`);
    set('debug-t-total', `${timings.total ?? '-'} ms`);
    set('debug-stages', (result.stagesApplied || []).join(', '));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.__anuragCameraApp = app; // exposed for debugging only
  app.init();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
