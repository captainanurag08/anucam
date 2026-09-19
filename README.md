# Anurag Camera

*Capture. Compute. Remember.*

A mobile-first camera Progressive Web App with a real, working computational
photography pipeline — HDR-style exposure fusion, Night mode stacking,
edge-aware denoise and sharpening, computational portrait blur, and document
scanning — built in plain HTML/CSS/JavaScript with zero runtime dependencies,
zero backend, and zero build step. It runs entirely in the browser, entirely
on your device.

This project is inspired by the *engineering principles* behind modern
smartphone computational photography (multi-frame capture, tone mapping,
scene-adaptive processing). It does not use, copy, or embed any Apple code,
assets, or proprietary algorithms — see [Honest limitations](#honest-limitations-what-this-is-not)
below for exactly where the line is drawn and why.

---

## 1. What it does

- Opens your phone's actual camera and shows a live preview — this is a real
  camera app, not a mockup.
- Captures photos and video, detects your device/browser's capabilities, and
  automatically chooses how much processing it's safe to do.
- Runs every captured photo through a real multi-stage processing pipeline
  (see [section 10](#10-the-processing-pipeline)) instead of a single
  brightness/contrast/saturation slam.
- Falls back gracefully at every layer — no camera feature, missing browser
  API, weak GPU, or processing failure ever crashes the app or loses your
  photo.

## 2. Features

- **Modes:** Photo, Portrait (computational background blur), Night
  (multi-frame stacking), Video, Document (scan + perspective-correct).
- **Live controls:** pinch/tap zoom (0.5×/1×/2×/3×, clearly distinguishing
  optical/hardware zoom from digital crop), tap-to-focus, exposure
  compensation, flash/torch (auto/on/off, hidden entirely on cameras without
  one), timer (3s/5s/10s), grid (3×3/4×4), aspect ratio (4:3/16:9/1:1/full).
- **Quality presets:** Natural, Smart, HDR, Night, Detail, Portrait, Max —
  each tunes every pipeline stage's strength rather than being a cosmetic
  filter.
- **Gallery:** IndexedDB-backed, with a before/after comparison slider,
  share/save/delete, and photo info.
- **Editor:** brightness/contrast/highlights/shadows/saturation/temperature/
  sharpness/noise-reduction sliders (each backed by the same processing
  modules the camera uses, not CSS filters), crop, rotate, and one-tap Auto
  Enhance.
- **Settings:** camera defaults, grid/timer/aspect, processing preset,
  white balance, performance mode (Auto/Battery saver/Performance), storage
  usage + clear-all, and a developer debug overlay with live timings.
- **PWA:** installable, with an offline-capable app shell (the camera itself
  still needs a live connection — see [HTTPS](#4-https-requirement)).

## 3. Running it locally

Camera access requires a *secure context* (see below), so you can't just
double-click `index.html`. Any static file server works:

```bash
# Python (built into most systems)
cd anurag-camera
python3 -m http.server 8443

# or Node, if you have it
npx serve .
```

Then open `https://<your-computer's-LAN-IP>:PORT` on your phone (see
[HTTPS](#4-https-requirement) — a plain `http://` server only works if you
open it as `http://localhost`, which doesn't help a *phone* on the same
Wi-Fi). The simplest path for real on-phone testing is usually
[GitHub Pages](#5-deploying-to-github-pages), which gives you HTTPS for
free with zero configuration.

```
Download project
      |
Open terminal, run a local server
      |
Open the HTTPS URL on your phone
      |
Allow camera access
      |
(Optional) Install as a PWA from the browser menu
```

## 4. HTTPS requirement

Browsers only grant camera access (`getUserMedia`) on a **secure context**:

- `https://` — always works.
- `http://localhost` or `http://127.0.0.1` — works, but only on the same
  machine (a phone can't reach your laptop's `localhost`).
- Any other plain `http://` origin, including your LAN IP — **camera access
  will be blocked**, and the app will show a specific "requires HTTPS"
  message rather than a silent failure.

For real-device testing over Wi-Fi, either use a tool that gives you an
HTTPS tunnel to your local server, or just deploy to GitHub Pages (next
section), which is free HTTPS with no setup.

## 5. Deploying to GitHub Pages

The app is 100% static — no server, no database, no API key, no build step.

1. Push this folder to a GitHub repository.
2. Repo Settings → Pages → Deploy from branch → pick `main` and `/ (root)`.
3. GitHub serves it at `https://<user>.github.io/<repo>/` over HTTPS
   automatically — camera access will work immediately.

## 6. Installing as a PWA

Once the app is loaded over HTTPS:

- **Android Chrome:** menu (⋮) → "Install app" / "Add to Home screen".
- **Samsung Internet:** menu → "Add page to" → "Home screen".
- The installed app opens full-screen (`standalone` display mode) with its
  own icon, no browser chrome.
- The app shell (UI) is cached for offline startup; the camera itself still
  needs a live connection each time, since `getUserMedia` has no offline
  mode.

## 7. Browser compatibility

| Browser | Support |
|---|---|
| Android Chrome | Primary target. Full feature set where the device supports it. |
| Samsung Internet | Supported; some track-level controls (zoom/torch) vary by device firmware. |
| Android Firefox | Supported; `ImageCapture` and the Shape Detection API (`FaceDetector`) are typically unavailable, so the app automatically uses the canvas-capture fallback and generic (non-face-aware) processing. |
| Desktop Chrome/Edge | Works, useful for development — uses your webcam. |
| Safari (iOS/desktop) | Not a target per the spec, and untested; WebKit lacks several of the APIs this app feature-detects around (`ImageCapture`, Shape Detection), so it should still degrade gracefully rather than break, but expect a reduced feature set. |

Every capability is feature-detected at runtime (`capabilities.js` +
per-track checks in `camera.js`) — nothing is assumed, and every control
tied to an unsupported capability is hidden rather than left broken.

## 8. Camera limitations (read this before filing a "bug")

A browser cannot do everything a native camera app can. Specifically, this
app **cannot**:

- Access RAW sensor data — everything comes through `getUserMedia`/
  `ImageCapture` *after* the device's own image signal processor has already
  demosaiced, white-balanced, and denoised the frame once.
- Guarantee manual ISO, shutter speed, or true optical zoom control — these
  depend entirely on what the browser and device firmware choose to expose
  via `MediaTrackCapabilities`, which varies a lot between devices.
- Guarantee a torch/flash on the front camera, or on any camera on devices
  that don't expose one to the browser.

None of this is a bug in the app; it's the actual ceiling of what
`getUserMedia`/`ImageCapture` expose to a web page today. The app detects
each of these per-device and hides or disables the corresponding control
rather than showing something that doesn't work.

## 9. Low-end device behavior

At startup, `capabilities.js` scores the device (memory, CPU core count,
WebGL/OffscreenCanvas support, screen resolution) into a `low`/`mid`/`high`
tier. That tier then:

- Caps the working resolution the pipeline processes at (1600px long edge on
  `low`, 2400px on `mid`, 3600px on `high`) — see `pipeline.js`.
- Skips multi-frame HDR/Night capture entirely on `low` tier, using the
  single-frame fallback instead.
- Skips the local-contrast stage on `low` tier.
- Scales denoise/sharpen/contrast strength by tier and by the "Performance
  mode" setting (Auto / Battery saver / Performance).

Settings → Developer → **Debug overlay** shows the detected tier and a live
per-stage timing breakdown for the last capture, which is the fastest way to
see exactly what the pipeline did and how long each stage took on a given
device.

## 10. The processing pipeline

```
capture -> analysis -> white balance -> HDR/Night fusion -> denoise
        -> tone map -> local contrast -> color grading
        -> (portrait blur | document correction) -> sharpen -> output
```

Every stage lives in its own file under `processing/`, is a plain function
operating on `{data, width, height}` pixel buffers (no DOM dependency), and
is independently unit-tested (`tests/processing-tests.js`). Briefly:

- **`analyzer.js`** — histogram, exposure/clipping, a noise estimate, edge
  density, and a rough color-temperature proxy, all computed once per
  capture and used to drive every later stage's strength.
- **`align.js`** — lightweight global-translation alignment between burst
  frames (a small block search on a downsampled thumbnail), used by both
  HDR and Night. Falls back to the unshifted frame when confidence is low,
  rather than risk ghosting.
- **`hdr.js`** — a **single-scale simplification** of Mertens/Kautz/Van
  Reeth exposure fusion (well-exposedness × saturation × local-contrast
  weighting, blended across frames). This is an intentional simplification
  of full Laplacian-pyramid exposure fusion, chosen to keep it fast enough
  for a browser on mid-range hardware — not a claim of the complete
  algorithm.
- **`night.js`** — aligns and averages a burst (temporal noise reduction:
  noise falls roughly with √N frames), then recovers shadow/highlight
  detail via the shared tone curve.
- **`denoise.js`** — a real bilateral filter (spatial × range Gaussian
  weighting), not a blur — it smooths flat regions while leaving real edges
  alone.
- **`toneMap.js`** — a parametric tone curve (black point → shadow lift →
  midtone S-curve → highlight roll-off), applied in luminance and rescaled
  back into RGB to preserve hue — not `brightness += 20`.
- **`color.js`** — vibrance/saturation with highlight/shadow tapering and a
  heuristic skin-tone hue band that's protected from oversaturation.
- **`sharpen.js`** — an edge-aware unsharp mask: a Laplacian high-pass
  gated by local edge magnitude, so flat skies and smooth skin don't pick up
  sharpening halos.
- **`faceProtect.js` / `portrait.js`** — face detection via the browser's
  Shape Detection API where available (fully feature-detected; silently
  returns no faces where unsupported, never a cloud API); a feathered mask
  anchored to the face (or the user's focus tap, if no face is found)
  drives both skin protection in `color.js`/`sharpen.js` and the Portrait
  mode background blur.
- **`document.js`** — Sobel edge detection + Otsu thresholding to find a
  document's corners, a proper 4-point homography solve (the same linear
  algebra behind e.g. OpenCV's `getPerspectiveTransform`) for perspective
  correction, then a contrast/white-point normalize.

## 11. Privacy

- **All processing happens on-device**, in a Web Worker when available.
  No photo, video, or frame is ever sent to a server.
- No analytics, no tracking, no third-party scripts. The only external
  network requests this app's *code* ever makes are none — check
  `service-worker.js` and any `js/*.js` file yourself; there is no
  `fetch()` to anything other than same-origin app-shell files.
- Photos/videos live in **IndexedDB**, entirely local to the browser. The
  service worker's cache holds only static app-shell files (HTML/CSS/JS/
  icons) and is never allowed to touch photo data — see the comment block
  at the top of `service-worker.js`.
- Settings are small JSON in `localStorage` — never image data.

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Camera access requires HTTPS" | You opened the app over plain `http://` on a non-localhost address. See [section 4](#4-https-requirement). |
| "Camera access is blocked" | The browser has a stored "deny" for this origin. Open the browser's site settings for this page and re-allow camera, then reload. |
| Flash/torch button is hidden | That camera doesn't expose torch control to the browser — this is a hardware/driver limitation, not a bug. |
| Zoom only goes to 1× | The device doesn't expose a `zoom` constraint on that camera; digital zoom via cropping is not implemented as a further fallback in this build (see [Honest limitations](#honest-limitations-what-this-is-not)). |
| Night/HDR looks like a single frame | On `low` tier devices (or Battery saver mode), multi-frame capture is intentionally skipped in favor of the faster single-frame path. |
| App won't install / no "Add to Home screen" | Confirm you're on HTTPS and that `manifest.json` is reachable (check devtools → Application → Manifest for errors). |

## 13. Known browser limitations

- `ImageCapture` (used for max-resolution stills) is Chromium-only;
  Firefox/Safari fall back to reading frames from the live video stream at
  its streaming resolution, which is usually somewhat lower than the
  sensor's full photo resolution.
- The Shape Detection API (`FaceDetector`) is Chromium-only and not
  guaranteed even there. Without it, Portrait mode still works, anchored to
  wherever you tap to focus instead of a detected face.
- `MediaTrackCapabilities` (zoom/torch/focus/exposure) varies significantly
  by device and OS camera HAL — two phones with the "same" Chrome version
  can expose a different subset of controls.
- Module Web Workers require a reasonably modern browser; where they're
  unavailable, the app runs the same pipeline on the main thread instead
  (slower, with a visible processing indicator, but functionally identical
  output).

## 14. Future native-Android upgrade path

The web app is fully functional on its own and does not require this. If a
native wrapper is ever built on top (Capacitor/Cordova-style, or a thin
Camera2/CameraX-backed WebView bridge), the architecture already supports
it cleanly:

- `camera.js` and `capture.js` are the *only* files that talk to
  `getUserMedia`/`ImageCapture`. A native bridge would replace just these
  two, exposing the same `CameraController` shape (`init`, `switchCamera`,
  `applyZoom`, `applyTorch`, capture functions) backed by Camera2/CameraX —
  RAW/DNG capture, true sensor exposure control, and hardware HDR — while
  every file in `processing/`, `js/gallery.js`, `js/editor.js`,
  `js/storage.js`, and all of `css/` would need zero changes.
- The processing pipeline already operates on plain pixel buffers, not
  anything browser-specific, so it would run unmodified on native-captured
  frames too.

---

## Honest limitations (what this is not)

In the interest of not overclaiming: this app does **not** implement Apple's
Photonic Engine, Deep Fusion, Smart HDR, or any proprietary Apple
technology — those are closed, hardware-coupled systems this project has no
access to and does not attempt to reverse-engineer. What it does implement
is a set of established, published computational-photography techniques
(exposure fusion, bilateral denoising, tone curves, edge-aware sharpening,
homography-based perspective correction) in a browser-feasible, adaptive
pipeline, described honestly above. A few specific, deliberate scope
decisions:

- **No WebAssembly module ships in this build.** `capabilities.js` still
  detects WASM support (useful if you add a module later), but there's no
  compiler toolchain available in this build environment and no network
  access to fetch one, so rather than fake it, the entire pipeline runs in
  plain JavaScript. Nothing here depends on WASM being present, so this is
  a "doesn't exist" situation, not a "fails and falls back" one.
- **Portrait mode blur is a heuristic, not true depth segmentation.** There
  is no depth sensor and no bundled ML segmentation model (which would mean
  either a cloud API — against this app's own privacy stance — or shipping
  several megabytes of a TensorFlow.js model). Instead it's a feathered
  mask anchored to a detected face or your focus tap, extended toward where
  shoulders/torso typically are. It is deliberately labeled "computational
  blur" in this document instead of claiming subject segmentation.
- **HDR fusion is single-scale**, not full Laplacian-pyramid exposure
  fusion — see [section 10](#10-the-processing-pipeline).
- **Digital zoom beyond 1× does not further crop/re-render the frame** in
  this build — it applies the camera's own `zoom` constraint where the
  hardware exposes one, and otherwise scales the live preview via CSS
  `transform`. A "true" digital zoom (crop the full-resolution capture in
  the processing pipeline) is a natural next addition but is not in this
  build.

None of these are secret — they're the honest edges of what's feasible in a
static, dependency-free, privacy-first web app, and every one of them
degrades gracefully rather than crashing or silently producing a broken
photo.

---

## License

MIT — see [`LICENSE`](./LICENSE). Change it if your project needs something
else.
