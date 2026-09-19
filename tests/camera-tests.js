/**
 * camera-tests.js — manual QA checklist (spec sections 56, 61).
 *
 * This is intentionally NOT an automated test suite. Real camera
 * hardware, permission prompts, lighting conditions, and device tiers
 * cannot be meaningfully faked in Node or a headless environment — a
 * mocked getUserMedia would only prove the mock works, not the camera.
 * Rather than dress that up as automated coverage, this file is a
 * structured, runnable checklist: `node tests/camera-tests.js` prints it
 * as a readable script for a human tester to follow on a real device.
 * (processing-tests.js and capability-tests.js cover what genuinely can
 * be automated — the algorithms and the capability-detection logic.)
 */

const CHECKLIST = [
  {
    category: 'Regression checks (bugs found via real deployments)',
    cases: [
      'Capture a photo in every mode (Photo, Portrait, Night, HDR quality preset, Document) and confirm each one actually reaches the gallery — not just that the shutter animates. (Found: fitWithinLongEdge()\'s thumbnail output is a plain {data,width,height} object, not a real ImageData; passing it straight to canvas.putImageData() threw "parameter 1 is not of type \'ImageData\'" and silently aborted the save on every single capture. Fixed via capture.js\'s toRealImageData() bridge.)',
      'With the Worker intentionally broken (e.g. rename js/workers/image-worker.js temporarily), capture a photo -> should fail over to the main-thread pipeline and still save correctly, not hang or throw.',
    ],
  },
  {
    category: 'End-to-end flow (spec section 61)',
    cases: [
      'Open the app fresh -> permission screen appears (not a blank page).',
      'Grant camera permission -> live preview appears within ~1s.',
      'Switch front/rear camera -> preview swaps, front is mirrored if that setting is on.',
      'Pinch or tap 0.5x/1x/2x/3x -> preview zooms; digital-only levels are visually distinguishable from optical if the device has none.',
      'Tap to focus -> ring appears at the tap point; turns amber if the browser actually accepted a focus/exposure point, stays neutral otherwise.',
      'Press shutter (Photo mode) -> shutter animation, then a "Saved" toast with a processing time.',
      'Open Gallery -> the new photo appears first, as a thumbnail.',
      'Open the photo -> before/after slider drags smoothly between original and enhanced.',
      'Share / Save / Delete each work from the viewer.',
      'Edit a photo -> sliders visibly change the preview; Save writes a new gallery entry.',
    ],
  },
  {
    category: 'Fallback paths (spec section 61)',
    cases: [
      'Force ImageCapture unavailable (e.g. Firefox) -> Photo capture still works via canvas-grab-from-video; no console errors.',
      'Force WebGL unavailable (disable in chrome://flags or similar) -> app still starts and processes photos (CPU/Canvas2D path only).',
      'Kill the Worker (e.g. block js/workers/image-worker.js in devtools) -> capture still completes via the main-thread pipeline fallback, just slower, with a visible processing indicator.',
      'Deny camera permission -> a specific, actionable message appears, never a bare "Error."',
      'Revoke permission mid-session / camera taken by another app -> app shows a message rather than a white screen or an infinite spinner.',
    ],
  },
  {
    category: 'Scene coverage (spec section 56)',
    cases: [
      'Bright daylight, sky + foliage + fine detail in frame -> no clipped-white sky, no neon-green foliage, fine detail (leaves, brick) stays crisp not mushy.',
      'Indoor, mixed/warm lighting -> white balance looks neutral-to-pleasant, not a strong orange or green cast; shadows retain some detail.',
      'Low light / Night mode -> visibly brighter and cleaner than Photo mode on the same scene; no heavy ghosting on a mostly-static subject; no extreme blown highlights on any light source in frame.',
      'Portrait mode, person centered -> background blur increases gradually away from the subject, no hard cutout ring around hair/shoulders.',
      'High contrast scene (bright sky + dark foreground) -> both ends retain some detail; no visible halo ringing around the horizon line.',
      'Moving subject (person walking, passing car) -> Photo mode has no ghosting; HDR/Night mode either aligns correctly or visibly falls back to a single sharp frame instead of ghosting.',
      'Document mode on a sheet of paper on a contrasting table -> edges detected and straightened; on a low-contrast/cluttered surface, falls back to an uncorrected but still enhanced photo rather than a warped mess.',
    ],
  },
  {
    category: 'Low-end device behavior (spec sections 2, 32, 56, 57)',
    cases: [
      'On a device that reports low deviceMemory/hardwareConcurrency (or with Performance mode set to "Battery saver"), confirm: local contrast stage is skipped, HDR/Night multi-frame capture is skipped in favor of the single-frame fallback, and the working resolution is visibly capped (see Settings > Developer > Debug overlay > "Resolution" vs. the saved photo\'s actual dimensions).',
      'Rapidly tap the shutter several times -> no crash, no more than one capture processes at a time (busy state on the shutter button).',
      'Capture ~15 photos in a row -> UI stays responsive; memory does not climb unbounded (check devtools Performance/Memory panel).',
      'Background the app/tab during processing and return -> either the result completes or a "Capture failed" message is shown; never a stuck spinner.',
    ],
  },
  {
    category: 'PWA / offline (spec sections 37, 49, 50)',
    cases: [
      'Serve over HTTPS (or localhost) -> camera works; over plain HTTP on a non-localhost host -> a clear "requires HTTPS" message, no crash.',
      '"Install" the PWA -> app icon and name appear correctly; opens in standalone mode (no browser chrome).',
      'After installing once online, put the device in airplane mode and relaunch -> the app shell (UI) still loads; the viewfinder shows a clear message since the camera itself is unavailable offline, rather than hanging.',
      'Check devtools Application > IndexedDB -> photos/videos are present there, not in the service worker\'s Cache Storage.',
    ],
  },
];

function printChecklist() {
  console.log('Anurag Camera — manual QA checklist\n' + '='.repeat(40));
  for (const section of CHECKLIST) {
    console.log(`\n${section.category}`);
    section.cases.forEach((c, i) => console.log(`  [ ] ${i + 1}. ${c}`));
  }
  const total = CHECKLIST.reduce((n, s) => n + s.cases.length, 0);
  console.log(`\n${total} manual checks across ${CHECKLIST.length} categories. This script only prints the checklist — check items off by hand on a real device.`);
}

printChecklist();

export { CHECKLIST };
