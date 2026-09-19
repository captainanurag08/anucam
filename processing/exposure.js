/**
 * exposure.js — turns analyzer.js statistics into exposure-correction
 * parameters (target-luminance based EV shift, shadow lift, highlight
 * compression) that toneMap.js applies as a smooth curve. See spec
 * section 12: "If highlights are already clipping -> reduce exposure or
 * highlight compression. If shadows are dark -> shadow recovery."
 */

export function computeExposureAdjustment(analysis) {
  const targetLuminance = 0.46;
  let ev = (targetLuminance - analysis.meanLuminance) * 1.8;
  ev = Math.max(-0.35, Math.min(0.35, ev));

  let shadowLift = 0;
  if (analysis.shadowClipping > 0.02) {
    shadowLift = Math.min(0.35, analysis.shadowClipping * 3);
  }

  let highlightCompression = 0;
  if (analysis.highlightClipping > 0.01) {
    highlightCompression = Math.min(0.5, analysis.highlightClipping * 6);
  }

  // Already well-balanced and already clean -> pull back further correction
  // (spec section 53: more processing is not automatically better).
  if (analysis.highlightClipping < 0.002 && analysis.shadowClipping < 0.01 &&
      analysis.contrast > 0.12 && analysis.contrast < 0.32) {
    ev *= 0.5;
  }

  return { ev, shadowLift, highlightCompression };
}
