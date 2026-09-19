/**
 * permissions.js — camera permission flow and error messaging
 * (spec section 39). Every getUserMedia failure mode gets a specific,
 * actionable message instead of a bare "Error."
 */

export function isSecureContext() {
  return typeof window !== 'undefined' && (window.isSecureContext ||
    location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

export async function queryCameraPermissionState() {
  if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'camera' });
    return status.state; // 'granted' | 'denied' | 'prompt'
  } catch (e) {
    return 'unknown';
  }
}

export async function requestCameraStream(constraints) {
  if (!isSecureContext()) {
    throw new CameraError('insecure-context',
      'Camera access requires HTTPS (or localhost). Open this app over a secure connection.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraError('unsupported',
      'This browser does not support camera access. Try the latest Chrome or Firefox for Android.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    throw mapGetUserMediaError(err);
  }
}

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function mapGetUserMediaError(err) {
  const name = err && err.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError('denied',
        'Camera access is blocked. Open your browser\'s site settings and allow camera access for this page, then reload.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('no-camera',
        'No usable camera was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError('in-use',
        'The camera could not be started — it may already be in use by another app. Close other camera apps and try again.');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraError('overconstrained',
        'This camera does not support the requested settings. Trying a simpler configuration.');
    case 'AbortError':
      return new CameraError('aborted', 'Camera access was interrupted. Please try again.');
    case 'SecurityError':
      return new CameraError('insecure-context',
        'Camera access requires HTTPS (or localhost). Open this app over a secure connection.');
    default:
      return new CameraError('unknown', 'Could not access the camera. Please try again.');
  }
}
