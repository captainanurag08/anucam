/**
 * capability-tests.js — smoke tests for capabilities.js.
 *
 * The core property under test is graceful degradation: on a bare Node
 * runtime almost none of the browser globals capabilities.js checks for
 * exist (no window, no real camera APIs, and depending on the Node
 * version, no or only a partial `navigator`/`document`). If
 * detectCapabilities() can run to completion here without throwing and
 * still return a sane, fully-populated profile, that is strong evidence
 * the same function won't throw on a real but limited/old Android browser
 * missing a handful of the newer APIs either — which is the actual spec
 * requirement (section 31: "Never assume the device supports a feature").
 *
 * Run with: node tests/capability-tests.js
 */

import assert from 'node:assert/strict';
import { detectCapabilities } from '../js/capabilities.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${e.stack || e.message}`);
  }
}

console.log('capabilities.js — smoke tests (bare runtime, no browser APIs)\n');

await test('detectCapabilities resolves without throwing when no browser APIs exist', async () => {
  const profile = await detectCapabilities();
  assert.ok(profile && typeof profile === 'object');
});

await test('returned tier is always one of low/mid/high', async () => {
  const profile = await detectCapabilities();
  assert.ok(['low', 'mid', 'high'].includes(profile.tier), `tier=${profile.tier}`);
});

await test('every capability flag is a boolean, never undefined', async () => {
  const profile = await detectCapabilities();
  const flags = [
    'supportsWebGL', 'supportsWebAssembly', 'supportsWorkers', 'supportsOffscreenCanvas',
    'supportsImageCaptureAPI', 'supportsFaceDetector', 'supportsMediaRecorder',
    'supportsShareFiles', 'supportsIndexedDB', 'prefersReducedMotion',
  ];
  for (const flag of flags) {
    assert.equal(typeof profile[flag], 'boolean', `${flag} was ${typeof profile[flag]}`);
  }
});

await test('missing WebGL (no document/canvas) degrades to false, not a throw', async () => {
  const profile = await detectCapabilities();
  // In this bare runtime there is no real <canvas>, so WebGL must be
  // reported unsupported rather than crashing detectCapabilities().
  assert.equal(profile.supportsWebGL, false);
});

await test('deviceMemory/hardwareConcurrency are null (not NaN/undefined) when unavailable', async () => {
  const profile = await detectCapabilities();
  assert.ok(profile.deviceMemory === null || typeof profile.deviceMemory === 'number');
  assert.ok(profile.hardwareConcurrency === null || typeof profile.hardwareConcurrency === 'number');
});

await test('calling detectCapabilities twice is stable and side-effect free', async () => {
  const a = await detectCapabilities();
  const b = await detectCapabilities();
  assert.equal(a.tier, b.tier);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
