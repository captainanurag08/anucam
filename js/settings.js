/**
 * settings.js — user preferences (spec section 44). Small JSON only,
 * stored in localStorage; photo/video binary data always lives in
 * IndexedDB via storage.js, never here.
 */

const KEY = 'anurag-camera-settings';

export const DEFAULT_SETTINGS = {
  defaultCamera: 'environment',
  mirrorFrontCamera: true,
  grid: 'off',
  timer: 'off',
  aspectRatio: '4:3',
  saveOriginal: true,
  shutterSound: true,
  processingPreset: 'smart',
  performanceMode: 'auto',
  whiteBalance: 'auto',
  debugMode: false,
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (e) {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export function updateSetting(key, value) {
  const settings = getSettings();
  settings[key] = value;
  persist(settings);
  return settings;
}

export function updateSettings(patch) {
  const settings = { ...getSettings(), ...patch };
  cache = settings;
  persist(settings);
  return settings;
}

export function resetSettings() {
  cache = { ...DEFAULT_SETTINGS };
  persist(cache);
  return cache;
}

function persist(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    // localStorage unavailable (private mode / quota) — settings simply
    // won't persist across sessions; the app keeps working in-memory.
  }
}

/**
 * initSettingsScreen — wires the Settings screen's DOM (spec section 44)
 * to the persisted preferences above. `app` exposes the handful of methods
 * settings need to affect live state immediately (mirror preview, grid).
 */
export function initSettingsScreen(app) {
  const settings = getSettings();

  bindSelect('setting-default-camera', settings.defaultCamera, (v) => updateSetting('defaultCamera', v));
  bindToggle('setting-mirror-front', settings.mirrorFrontCamera, (v) => {
    updateSetting('mirrorFrontCamera', v);
    app.applyMirrorPreference();
  });
  bindSelect('setting-grid', settings.grid, (v) => { updateSetting('grid', v); app.setGrid(v); });
  bindSelect('setting-timer', settings.timer, (v) => { updateSetting('timer', v); app.setTimer(v); });
  bindSelect('setting-aspect', settings.aspectRatio, (v) => { updateSetting('aspectRatio', v); app.setAspectRatio(v); });
  bindToggle('setting-save-original', settings.saveOriginal, (v) => updateSetting('saveOriginal', v));
  bindToggle('setting-shutter-sound', settings.shutterSound, (v) => updateSetting('shutterSound', v));
  bindSelect('setting-processing-preset', settings.processingPreset, (v) => { updateSetting('processingPreset', v); app.setQuality(v); });
  bindSelect('setting-performance-mode', settings.performanceMode, (v) => { updateSetting('performanceMode', v); app.setPerformanceMode(v); });
  bindSelect('setting-white-balance', settings.whiteBalance, (v) => updateSetting('whiteBalance', v));
  bindToggle('setting-debug-mode', settings.debugMode, (v) => { updateSetting('debugMode', v); app.setDebugMode(v); });

  const clearBtn = document.getElementById('setting-clear-cache');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Delete all saved photos and videos from this device? This cannot be undone.')) return;
      await app.clearGalleryStorage();
    });
  }
}

function bindToggle(id, initial, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!initial;
  el.addEventListener('change', () => onChange(el.checked));
}

function bindSelect(id, initial, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = initial;
  el.addEventListener('change', () => onChange(el.value));
}
