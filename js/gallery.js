/**
 * gallery.js — internal gallery (spec section 28).
 */

import { getAllMedia, deleteMedia, getMedia } from './storage.js';
import { showToast, formatBytes, formatTimestamp, switchScreen } from './ui.js';

let objectUrls = [];
let currentViewerId = null;

function trackUrl(url) {
  objectUrls.push(url);
  return url;
}

function revokeAllUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

export async function openGallery() {
  switchScreen('gallery');
  await renderGrid();
}

export async function refreshGalleryThumb() {
  const thumbEl = document.getElementById('gallery-thumb');
  if (!thumbEl) return;
  const items = await getAllMedia();
  if (!items.length) { thumbEl.style.backgroundImage = ''; return; }
  const url = trackUrl(URL.createObjectURL(items[0].thumbnailBlob || items[0].blob));
  thumbEl.style.backgroundImage = `url(${url})`;
}

async function renderGrid() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  if (!grid) return;
  revokeAllUrls();
  grid.innerHTML = '';

  const items = await getAllMedia();
  empty.hidden = items.length > 0;

  for (const item of items) {
    const cell = document.createElement('button');
    cell.className = 'gallery-cell';
    cell.setAttribute('aria-label', `Open photo from ${formatTimestamp(item.createdAt)}`);
    const url = trackUrl(URL.createObjectURL(item.thumbnailBlob || item.blob));
    cell.style.backgroundImage = `url(${url})`;
    if (item.type === 'video') {
      const badge = document.createElement('span');
      badge.className = 'gallery-cell-badge';
      badge.textContent = formatDuration(item.durationMs);
      cell.appendChild(badge);
    }
    cell.addEventListener('click', () => openViewer(item.id));
    grid.appendChild(cell);
  }
}

async function openViewer(id) {
  const item = await getMedia(id);
  if (!item) return;
  currentViewerId = id;

  const viewer = document.getElementById('gallery-viewer');
  const imgEl = document.getElementById('gallery-viewer-img');
  const videoEl = document.getElementById('gallery-viewer-video');
  const enhancedUrl = trackUrl(URL.createObjectURL(item.blob));

  if (item.type === 'video') {
    imgEl.hidden = true;
    videoEl.hidden = false;
    videoEl.src = enhancedUrl;
    setupCompareSlider(null);
  } else {
    videoEl.hidden = true;
    imgEl.hidden = false;
    imgEl.src = enhancedUrl;
    if (item.originalBlob) {
      const originalUrl = trackUrl(URL.createObjectURL(item.originalBlob));
      setupCompareSlider(originalUrl);
    } else {
      setupCompareSlider(null);
    }
  }

  document.getElementById('viewer-info-mode').textContent = item.mode || 'photo';
  document.getElementById('viewer-info-size').textContent = `${item.width}x${item.height} · ${formatBytes(item.sizeBytes)}`;
  document.getElementById('viewer-info-date').textContent = formatTimestamp(item.createdAt);

  viewer.classList.add('viewer-open');
}

function setupCompareSlider(originalUrl) {
  const wrap = document.getElementById('before-after-wrap');
  const beforeImg = document.getElementById('before-image');
  const handle = document.getElementById('compare-handle');
  if (!wrap) return;

  if (!originalUrl) {
    wrap.classList.add('compare-disabled');
    return;
  }
  wrap.classList.remove('compare-disabled');
  beforeImg.src = originalUrl;
  wrap.style.setProperty('--compare-pos', '50%');

  const onMove = (clientX) => {
    const rect = wrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    wrap.style.setProperty('--compare-pos', `${pct}%`);
  };

  handle.onpointerdown = (e) => {
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev.clientX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
}

export function closeViewer() {
  document.getElementById('gallery-viewer').classList.remove('viewer-open');
  const videoEl = document.getElementById('gallery-viewer-video');
  if (videoEl) videoEl.pause();
  currentViewerId = null;
}

export async function deleteCurrentViewerItem() {
  if (!currentViewerId) return;
  await deleteMedia(currentViewerId);
  closeViewer();
  await renderGrid();
  await refreshGalleryThumb();
  showToast('Deleted.');
}

export async function shareCurrentViewerItem() {
  if (!currentViewerId) return;
  const item = await getMedia(currentViewerId);
  if (!item) return;
  const file = new File([item.blob], `anurag-camera-${item.id}.${item.type === 'video' ? 'webm' : 'jpg'}`, { type: item.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Anurag Camera' });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  downloadCurrentViewerItem();
}

export async function downloadCurrentViewerItem() {
  if (!currentViewerId) return;
  const item = await getMedia(currentViewerId);
  if (!item) return;
  const url = URL.createObjectURL(item.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `anurag-camera-${item.id}.${item.type === 'video' ? 'webm' : 'jpg'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function getCurrentViewerId() {
  return currentViewerId;
}

function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
