// What the two pose engines (the worker in pose-worker.js and MainThreadEngine in tracker.js) have in common,
// so a tuning change can't reach one and miss the other.
import { downsampleMaxInto } from './person-mask.js';

export const MASK_W = 256; // width of the merged silhouette mask the cut-out works on
export const LOOK_W = 96; // width of the tiny colour copy the looks (clothing colours) are sampled from

/**
 * PoseLandmarker options. Confidence thresholds are lower than the defaults (0.5): kids are less common in
 * the model's training data, so it is less sure about them and would otherwise drop them for a few frames.
 * @param {string} modelAssetPath
 * @param {'GPU' | 'CPU'} delegate
 * @param {boolean} masks  person silhouettes for the cut-out (~6-9 ms extra per frame)
 */
export function landmarkerOptions(modelAssetPath, delegate, masks) {
  return {
    baseOptions: { modelAssetPath, delegate },
    runningMode: /** @type {const} */ ('VIDEO'),
    numPoses: 4,
    outputSegmentationMasks: masks,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
  };
}

/**
 * All people's silhouettes OR-ed into one small array (maskW wide, the frame's shape), closing each MediaPipe
 * mask as it goes. { mask: null } when the model gave none.
 * @param {any[] | undefined} segmentationMasks
 * @param {number} maskW
 * @param {number} frameW
 * @param {number} frameH
 */
export function mergeMasks(segmentationMasks, maskW, frameW, frameH) {
  if (!segmentationMasks?.length) return { mask: null, maskH: 0 };
  const maskH = Math.round((maskW * frameH) / frameW);
  const mask = new Float32Array(maskW * maskH);
  for (const m of segmentationMasks) {
    try {
      downsampleMaxInto(m.getAsFloat32Array(), m.width, m.height, mask, maskW, maskH);
    } finally {
      m.close();
    }
  }
  return { mask, maskH };
}
