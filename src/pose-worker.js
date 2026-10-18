// Runs the pose model off the main thread, so the game keeps drawing at a smooth frame rate however long
// a frame of tracking takes (a phone can take 60 ms a frame). The main thread sends camera frames as
// ImageBitmaps; this worker answers with the skeletons, a small merged silhouette mask and each person's
// look (clothing colours). See PoseTracker in tracker.js for the other side.
//
// This is a CLASSIC worker (not type: 'module'): MediaPipe's loader uses importScripts(), which module
// workers don't allow. Our own modules are loaded with dynamic import() instead, which classic workers support.

/** @type {typeof import('./pose-shared.js')} */
let shared;
/** @type {typeof import('./look.js').lookOf} */
let lookOf;

let landmarker = null;
let make = null;
let delegate = 'GPU';
let modelName = 'full';
let masks = true;
let busy = false;
let look = null;
let lctx = null;

async function init({ base, model, masks: withMasks = true }) {
  masks = withMasks;
  shared = await import(new URL('./pose-shared.js', base).href);
  ({ lookOf } = await import(new URL('./look.js', base).href));
  const { FilesetResolver, PoseLandmarker } = await import(new URL('../vendor/vision_bundle.mjs', base).href);
  const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/wasm', base).href);
  make = (del, name, withMasks) =>
    PoseLandmarker.createFromOptions(fileset, shared.landmarkerOptions(new URL(`../models/pose_landmarker_${name}.task`, base).href, del, withMasks));
  look = new OffscreenCanvas(shared.LOOK_W, 54);
  lctx = look.getContext('2d', { willReadFrequently: true });
  modelName = model;
  try {
    landmarker = await make('GPU', model, masks);
    delegate = 'GPU';
  } catch (e) {
    console.warn('GPU delegate unavailable in the worker, using CPU', e);
    landmarker = await make('CPU', model, masks);
    delegate = 'CPU';
  }
  return { delegate };
}

async function setModel({ model, masks: withMasks }) {
  const next = await make(delegate, model, withMasks);
  landmarker?.close?.();
  landmarker = next;
  modelName = model;
  masks = withMasks;
}

function detect({ bitmap, ts, maskW = shared.MASK_W }) {
  const LOOK_W = shared.LOOK_W;
  const t0 = performance.now();
  let res;
  try {
    res = landmarker.detectForVideo(bitmap, ts);
  } catch (e) {
    bitmap.close();
    throw e;
  }
  // looks: a tiny colour copy of the frame, sampled at each person's top and legs
  const lh = Math.max(1, Math.round((LOOK_W * bitmap.height) / bitmap.width));
  if (look.height !== lh) look.height = lh;
  lctx.drawImage(bitmap, 0, 0, LOOK_W, lh);
  const rgba = lctx.getImageData(0, 0, LOOK_W, lh).data;
  const landmarks = res.landmarks.map((lm) => lm.map((l) => ({ x: l.x, y: l.y, visibility: l.visibility })));
  const looks = res.landmarks.map((lm) => lookOf(rgba, LOOK_W, lh, lm));
  // masks: all people merged into one small float array
  const { mask, maskH } = shared.mergeMasks(res.segmentationMasks, maskW, bitmap.width, bitmap.height);
  bitmap.close();
  return { landmarks, looks, mask, maskW, maskH, ms: performance.now() - t0, delegate, modelName };
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') self.postMessage({ id, ok: true, result: await init(e.data) });
    else if (type === 'model') self.postMessage({ id, ok: true, result: await setModel(e.data) });
    else if (type === 'detect') {
      if (busy) return self.postMessage({ id, ok: true, result: null });
      busy = true;
      try {
        const result = detect(e.data);
        self.postMessage({ id, ok: true, result }, { transfer: result.mask ? [result.mask.buffer] : [] });
      } finally {
        busy = false;
      }
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
