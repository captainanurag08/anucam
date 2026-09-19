/**
 * camera.js — camera stream lifecycle and live controls (spec sections 1,
 * 5, 6, 10). Track-level capabilities (zoom/torch/focus/exposure) can only
 * be known once a stream exists, so this module exposes them as
 * `trackCapabilities` after init(), separate from the browser/API-level
 * flags in capabilities.js.
 */

import { requestCameraStream, CameraError } from './permissions.js';

const STREAM_RESOLUTIONS = {
  low: { width: { ideal: 1280 }, height: { ideal: 960 } },
  mid: { width: { ideal: 1920 }, height: { ideal: 1440 } },
  high: { width: { ideal: 3840 }, height: { ideal: 2160 } },
};

export class CameraController {
  constructor(videoEl, deviceProfile) {
    this.video = videoEl;
    this.deviceProfile = deviceProfile || { tier: 'mid' };
    this.stream = null;
    this.track = null;
    this.facingMode = 'environment';
    this.trackCapabilities = {};
    this.imageCapture = null;
    this.availableDevices = [];
  }

  async init(preferredFacingMode = 'environment') {
    await this._enumerateDevices();
    await this._start(preferredFacingMode);
  }

  async _start(facingMode) {
    const res = STREAM_RESOLUTIONS[this.deviceProfile.tier] || STREAM_RESOLUTIONS.mid;
    const baseConstraints = {
      audio: false,
      video: { facingMode: { ideal: facingMode }, ...res },
    };

    let stream;
    try {
      stream = await requestCameraStream(baseConstraints);
    } catch (err) {
      if (err instanceof CameraError && err.code === 'overconstrained') {
        stream = await requestCameraStream({ audio: false, video: { facingMode: { ideal: facingMode } } });
      } else {
        throw err;
      }
    }

    this._teardownStream();
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.facingMode = facingMode;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});

    this._refreshTrackCapabilities();

    if (typeof ImageCapture !== 'undefined') {
      try { this.imageCapture = new ImageCapture(this.track); } catch (e) { this.imageCapture = null; }
    }
  }

  _refreshTrackCapabilities() {
    this.trackCapabilities = {};
    if (!this.track || typeof this.track.getCapabilities !== 'function') return;
    try {
      const caps = this.track.getCapabilities();
      this.trackCapabilities = {
        zoom: caps.zoom || null,
        torch: !!caps.torch,
        focusMode: caps.focusMode || null,
        exposureMode: caps.exposureMode || null,
        exposureCompensation: caps.exposureCompensation || null,
        pointsOfInterest: 'pointsOfInterest' in caps,
        width: caps.width || null,
        height: caps.height || null,
      };
    } catch (e) {
      this.trackCapabilities = {};
    }
  }

  async _enumerateDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableDevices = devices.filter((d) => d.kind === 'videoinput');
    } catch (e) {
      this.availableDevices = [];
    }
  }

  get hasMultipleCameras() {
    return this.availableDevices.length > 1 || true; // facingMode toggle is always offered; see switchCamera()
  }

  async switchCamera() {
    const next = this.facingMode === 'environment' ? 'user' : 'environment';
    await this._start(next);
    return this.facingMode;
  }

  async applyZoom(value) {
    if (!this.track || !this.trackCapabilities.zoom) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ zoom: value }] });
      return true;
    } catch (e) {
      return false;
    }
  }

  async applyTorch(on) {
    if (!this.track || !this.trackCapabilities.torch) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch (e) {
      return false;
    }
  }

  async applyFocusPoint(xNorm, yNorm) {
    if (!this.track) return false;
    try {
      const advanced = {};
      if (this.trackCapabilities.pointsOfInterest) advanced.pointsOfInterest = [{ x: xNorm, y: yNorm }];
      if (this.trackCapabilities.focusMode && String(this.trackCapabilities.focusMode).includes) {
        advanced.focusMode = 'continuous';
      }
      if (!Object.keys(advanced).length) return false;
      await this.track.applyConstraints({ advanced: [advanced] });
      return true;
    } catch (e) {
      return false;
    }
  }

  async applyExposureCompensation(value) {
    if (!this.track || !this.trackCapabilities.exposureCompensation) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ exposureCompensation: value }] });
      return true;
    } catch (e) {
      return false;
    }
  }

  getVideoNativeSize() {
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  _teardownStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
    this.track = null;
    this.imageCapture = null;
  }

  stop() {
    this._teardownStream();
    if (this.video) this.video.srcObject = null;
  }
}
