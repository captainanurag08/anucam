/**
 * ui.js — small cross-screen UI helpers (spec sections 42-43).
 */

export function showToast(message, duration = 2600) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

export function switchScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('screen-active', el.dataset.screen === name);
  });
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function playShutterAnimation() {
  const flash = document.getElementById('shutter-flash');
  if (!flash) return;
  if (prefersReducedMotion()) return;
  flash.classList.remove('flash-active');
  void flash.offsetWidth; // restart animation
  flash.classList.add('flash-active');
}

export function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }
}

export async function runCountdown(seconds, onTick) {
  const el = document.getElementById('timer-countdown');
  if (!el) { return; }
  el.classList.add('countdown-active');
  for (let s = seconds; s > 0; s--) {
    el.textContent = String(s);
    if (onTick) onTick(s);
    await sleep(1000);
  }
  el.classList.remove('countdown-active');
  el.textContent = '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatBytes(bytes) {
  if (bytes == null) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(ms) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
