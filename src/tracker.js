// Turns camera frames (or the mouse) into "players" the game can use.
//
// A player looks like:
//   { id, color, present, px[33] (screen-space landmarks), hands[], circles[],
//     sh, hip, cx, shoulderW, torso, lastJump, jumps, pose:{armsUp,airplane,handsHead}, score }
// Levels only ever read those fields, so any tracker (camera, mouse, a different
// model, a Pi build) can be swapped in without touching the game.

/** @import { Player, Point } from './types.js' */
import { OneEuro } from './filter.js';
import { cameraConstraints, nextCameraId, describeCamera, saveCamera, parseMode, withRetry, FpsGuard } from './camera.js';
import { downsampleMaxInto, skeletonMaskInto } from './person-mask.js';
import { People, COLORS } from './people.js';
import { lookOf } from './look.js';

export { COLORS };

export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Derive everything the game needs from the 33 screen-space landmarks in p.px.
 * @param {any} p  a Player (or anything with px[33]; the tests pass bare objects)
 * @param {number} now
 * @param {{ skipJump?: boolean }} [opts]
 */
// Duck: the head drops this many shoulder widths below the kid's own standing height.
const DUCK_DROP = 0.8;
// Joints whose speed makes up p.motion (nose, shoulders, wrists, hips, knees), and its smoothing time.
const MOTION_JOINTS = [0, 11, 12, 15, 16, 23, 24, 25, 26];
const MOTION_SMOOTH = 0.3; // seconds

export function computeFeatures(p, now, { skipJump = false } = {}) {
  const px = p.px;
  const sh = mid(px[11], px[12]);
  const hip = mid(px[23], px[24]);
  const shoulderW = Math.max(30, dist(px[11], px[12]));
  const torso = Math.max(40, dist(sh, hip));
  p.sh = sh;
  p.hip = hip;
  p.cx = sh.x;
  p.shoulderW = shoulderW;
  p.torso = torso;

  // Wrists + index fingertips count as "hands" for touching things.
  p.hands = [px[15], px[16], px[19], px[20]];

  // Body is a handful of circles (head, chest, belly, hips, knees) for dodging.
  const r = Math.max(35, shoulderW * 0.55);
  const knee = mid(px[25], px[26]);
  p.circles = [
    { x: px[0].x, y: px[0].y, r: r * 0.9 },
    { x: sh.x, y: sh.y, r },
    { x: (sh.x + hip.x) / 2, y: (sh.y + hip.y) / 2, r },
    { x: hip.x, y: hip.y, r },
    { x: knee.x, y: knee.y, r: r * 0.8 },
  ];

  // Jump = hips rise well above a slowly-adapting baseline (falls fast, rises slowly).
  if (!skipJump) {
    if (p.hipBase === undefined) p.hipBase = hip.y;
    p.hipBase += (hip.y - p.hipBase) * (hip.y > p.hipBase ? 0.25 : 0.01);
    const up = (p.hipBase - hip.y) / torso;
    const jumping = up > 0.28;
    if (jumping) {
      if (!p.wasJump) p.jumps++;
      p.lastJump = now;
    }
    p.wasJump = jumping;
  }

  // Duck baseline: the head's standing height. It follows the head up quickly (standing up straight,
  // stepping back) and down only slowly (stepping closer), and holds still while jumping so the top of a
  // jump doesn't make the landing look like a duck. Measured in shoulder widths, like the poses.
  const head = px[0].y;
  if (p.headBase === undefined) p.headBase = head;
  else if (!p.wasJump) p.headBase += (head - p.headBase) * (head < p.headBase ? 0.25 : 0.01);

  // Motion: average speed of the main joints in shoulder widths per second, smoothed over ~0.3 s, so a
  // single jittery frame can't make a frozen kid look like they moved.
  if (p.motionPx && now > p.motionT) {
    const dt = now - p.motionT;
    let sum = 0;
    for (const i of MOTION_JOINTS) sum += dist(px[i], p.motionPx[i]);
    const speed = Math.min(20, sum / MOTION_JOINTS.length / shoulderW / dt);
    p.motion += (speed - p.motion) * Math.min(1, dt / MOTION_SMOOTH);
  }
  p.motion ??= 0;
  p.motionPx = px.map((q) => ({ x: q.x, y: q.y }));
  p.motionT = now;

  // Simple rule-based poses. Everything is measured in shoulder-widths (s): the shoulders are the
  // best-tracked joints and the measure that stays sensible for small kids. (An earlier version used
  // torso length, which is estimated from the hips and is badly off for kids: bigger heads, shorter
  // arms, hips often mis-tracked. It rejected a toddler with both arms clearly in the air.)
  const s = shoulderW;
  const wl = px[15];
  const wr = px[16];
  const nose = px[0];
  const raw = {
    // both wrists clearly above the head
    armsUp: wl.y < nose.y - 0.4 * s && wr.y < nose.y - 0.4 * s,
    // arms straight out to the sides, roughly at shoulder height, one each side
    airplane:
      Math.abs(wl.y - sh.y) < 0.9 * s &&
      Math.abs(wr.y - sh.y) < 0.9 * s &&
      Math.abs(wl.x - sh.x) > 1.1 * s &&
      Math.abs(wr.x - sh.x) > 1.1 * s &&
      (wl.x - sh.x) * (wr.x - sh.x) < 0,
    // both hands next to the head (not stretched far overhead)
    handsHead:
      dist(wl, nose) < 0.9 * s &&
      dist(wr, nose) < 0.9 * s &&
      wl.y < sh.y - 0.25 * s &&
      wr.y < sh.y - 0.25 * s &&
      wl.y > nose.y - 0.7 * s &&
      wr.y > nose.y - 0.7 * s,
    // head well below where it is when standing (crouching, ducking under something)
    duck: head - p.headBase > DUCK_DROP * s,
  };

  // Hysteresis: a pose switches on once it has held for a couple of frames and only switches off
  // after it has really gone, so one glitchy frame can't flip it either way.
  p.poseEma ??= {};
  p.poseState ??= {};
  for (const key of Object.keys(raw)) {
    const prev = p.poseEma[key];
    const ema = prev === undefined ? (raw[key] ? 1 : 0) : prev + ((raw[key] ? 1 : 0) - prev) * 0.35;
    p.poseEma[key] = ema;
    p.poseState[key] = p.poseState[key] ? ema > 0.3 : ema > 0.6;
  }
  p.pose = { ...p.poseState };
  if (p.pose.duck) p.lastDuck = now;
}

// If tracking averages slower than this per frame, step down the quality ladder (see QUALITY and _watchSpeed).
// Measured from sending a frame to getting its answer back, which is the delay the kids actually see.
const SLOW_MS = 50;
// ...and if it averages faster than this for a long while, step back up.
const FAST_MS = 20;
// The ladder works in seconds, not frames: on a machine tracking 2 frames a second, "90 frames" was
// 45 s per step, minutes of lag before it got anywhere near a speed that works.
const WARMUP_S = 1; // the first frames after a start or a switch are always slow (shaders compile)
const MEASURE_S = 3; // how long to average before stepping down
const FAST_S = 20; // how long it must stay fast before stepping back up

// The quality ladder, best first. Each step is cheaper than the one before:
//   model:  'full' is noticeably better on children; 'lite' is about twice as fast
//   scale:  the camera frame is shrunk by this before tracking (landmarks are normalised, so nothing else changes)
//   masks:  the person silhouettes for the cut-out cost ~6-9 ms a frame; without them the cut-out runs on motion alone
export const QUALITY = [
  { name: 'high', model: 'full', scale: 1, masks: true },
  { name: 'medium', model: 'lite', scale: 1, masks: true },
  { name: 'low', model: 'lite', scale: 0.5, masks: true },
  { name: 'lowest', model: 'lite', scale: 0.5, masks: false },
];
const MASK_W = 256;
const LOOK_W = 96;

const assetUrl = (/** @type {string} */ rel) => new URL(rel, import.meta.url).href;

// Runs the pose model on the main thread. Simple, and the fallback when workers are not available, but
// the game can't draw while a frame is being tracked.
class MainThreadEngine {
  constructor() {
    this.landmarker = null;
    this.delegate = '?';
    this.look = document.createElement('canvas');
    this.look.width = LOOK_W;
    this.look.height = 54;
    this.lctx = this.look.getContext('2d', { willReadFrequently: true });
    /** @type {HTMLCanvasElement | null} the frame shrunk for the cheaper ladder rungs */
    this.small = null;
    this._make = null;
  }

  async init({ model, masks }) {
    const { FilesetResolver, PoseLandmarker } = await import(assetUrl('../vendor/vision_bundle.mjs'));
    const fileset = await FilesetResolver.forVisionTasks(assetUrl('../vendor/wasm'));
    // Confidence thresholds are lower than the defaults (0.5): kids are less common in the model's
    // training data, so it is less sure about them and would otherwise drop them for a few frames.
    this._make = (delegate, name, withMasks) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: assetUrl(`../models/pose_landmarker_${name}.task`), delegate },
        runningMode: 'VIDEO',
        numPoses: 4,
        outputSegmentationMasks: withMasks,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
    try {
      this.landmarker = await this._make('GPU', model, masks);
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU delegate unavailable, using CPU', e);
      this.landmarker = await this._make('CPU', model, masks);
      this.delegate = 'CPU';
    }
    return { delegate: this.delegate };
  }

  async setModel({ model, masks }) {
    const next = await this._make(this.delegate, model, masks);
    this.landmarker?.close?.();
    this.landmarker = next;
  }

  async fallbackToCpu(model, masks) {
    this.delegate = 'CPU';
    this.landmarker = await this._make('CPU', model, masks);
  }

  // Resolves with { landmarks, looks, mask, maskW, maskH, ms } (same shape as the worker's answer).
  async detect(video, ts, { scale, maskW }) {
    const t0 = performance.now();
    let source = video;
    if (scale !== 1) {
      this.small ??= document.createElement('canvas');
      this.small.width = Math.round(video.videoWidth * scale);
      this.small.height = Math.round(video.videoHeight * scale);
      this.small.getContext('2d').drawImage(video, 0, 0, this.small.width, this.small.height);
      source = this.small;
    }
    const res = this.landmarker.detectForVideo(source, ts);
    const lh = Math.max(1, Math.round((LOOK_W * video.videoHeight) / video.videoWidth));
    if (this.look.height !== lh) this.look.height = lh;
    this.lctx.drawImage(video, 0, 0, LOOK_W, lh);
    const rgba = this.lctx.getImageData(0, 0, LOOK_W, lh).data;
    const looks = res.landmarks.map((lm) => lookOf(rgba, LOOK_W, lh, lm));
    let mask = null;
    let maskH = 0;
    if (res.segmentationMasks?.length) {
      maskH = Math.round((maskW * video.videoHeight) / video.videoWidth);
      mask = new Float32Array(maskW * maskH);
      for (const m of res.segmentationMasks) {
        try {
          downsampleMaxInto(m.getAsFloat32Array(), m.width, m.height, mask, maskW, maskH);
        } finally {
          m.close();
        }
      }
    }
    return { landmarks: res.landmarks, looks, mask, maskW, maskH, ms: performance.now() - t0 };
  }

  close() {
    this.landmarker?.close?.();
  }
}

// Runs the pose model in a Web Worker (src/pose-worker.js): the main thread only ships frames and draws.
class WorkerEngine {
  constructor() {
    this.worker = new Worker(assetUrl('./pose-worker.js')); // classic: MediaPipe needs importScripts()
    this.pending = new Map();
    this.nextId = 1;
    this.delegate = '?';
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'pose worker failed'));
      this.pending.clear();
    };
  }

  _call(msg, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }

  async init({ model, masks }) {
    const r = await this._call({ type: 'init', base: import.meta.url, model, masks });
    this.delegate = r.delegate;
    return r;
  }

  setModel({ model, masks }) {
    return this._call({ type: 'model', model, masks });
  }

  fallbackToCpu() {
    return Promise.reject(new Error('the worker picks its own delegate'));
  }

  async detect(video, ts, { scale, maskW }) {
    const opts = scale === 1 ? {} : { resizeWidth: Math.round(video.videoWidth * scale), resizeHeight: Math.round(video.videoHeight * scale) };
    const bitmap = await createImageBitmap(video, opts);
    return this._call({ type: 'detect', bitmap, ts, maskW }, [bitmap]);
  }

  close() {
    this.worker.terminate();
  }
}

export class PoseTracker {
  // model: 'lite' | 'full'. Not given = start with the more accurate 'full' model (noticeably better
  // on children) and fall back to 'lite' automatically on a slow machine.
  // quality: a QUALITY name. Pins the whole ladder (model, frame size, masks). Not given = start at
  // `startQuality` and move up and down the ladder as the machine allows.
  // cameraMode: 'wide' | 'standard'. Not given = 'wide' (full field of view), dropping to 'standard' by itself
  // if the camera can't keep up.
  // worker: false runs the model on the main thread (also the fallback if a worker can't start).
  /** @param {{ model?: string | null, quality?: string | null, startQuality?: string, cameraMode?: string | null, worker?: boolean, retryDelayMs?: number }} [opts] */
  constructor({ model, quality, startQuality = 'high', cameraMode, worker = true, retryDelayMs = 250 } = {}) {
    this.retryDelayMs = retryDelayMs; // pause between retries when a camera is slow to let go (see camera.js)
    this.mode = parseMode(cameraMode) ?? 'wide';
    this.modePinned = parseMode(cameraMode) !== null;
    this.deviceId = null;
    this.cameraLabel = '';
    this.cameras = [];
    this.cameraFps = 0;
    this.fpsGuard = null;
    this._camQueue = Promise.resolve();
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.people = new People();
    /** @type {Player[]} the players the game sees this frame (present ones) */
    this.players = [];
    this.lastVideoTime = -1;
    this.detectMs = 0;
    this.delegate = '?';
    this.useWorker = worker && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';
    this.engine = null;
    // the quality ladder (see QUALITY). ?model= pins the model only; ?quality= pins everything.
    const pinnedModel = model === 'lite' || model === 'full' ? model : null;
    this.pinned = !!pinnedModel; // explicit model choice: never auto-switch the model
    this.qualityPinned = QUALITY.some((q) => q.name === quality);
    let level = QUALITY.findIndex((q) => q.name === (this.qualityPinned ? quality : startQuality));
    if (level < 0) level = 0;
    if (pinnedModel) level = QUALITY.findIndex((q) => q.model === pinnedModel);
    this.level = level;
    this.frames = 0;
    this.measured = 0;
    this.speedSum = 0;
    /** @type {number | null} */ this.watchStart = null;
    /** @type {number | null} */ this.measureStart = null;
    /** @type {number | null} */ this.fastSince = null;
    this.triedMainThread = false;
    this.switching = false;
    this.inflight = null;
    this.latest = null;
    this.failures = 0; // detections that failed in a row
    this.simulateLost = false; // tests: pretend the model finds nobody
    this.frameSeq = 0; // goes up by one with every tracked frame (the cut-out only redoes its work then)
    // The pose model also outputs a silhouette per person. The engine shrinks them (all people OR-ed
    // together) into one small array that the cut-out logic (person-mask.js) uses. null until the camera is up.
    this.maskW = MASK_W;
    this.maskH = 192;
    this.maskLow = null;
    this.W = 1280;
    this.H = 720;
  }

  get quality() {
    return QUALITY[this.level];
  }

  get modelName() {
    return this.quality.model;
  }

  setView(W, H) {
    this.W = W;
    this.H = H;
    this.people.setView(W);
  }

  // Where the (mirrored, cover-fitted) camera image sits on the canvas.
  videoRect() {
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    const s = Math.max(this.W / vw, this.H / vh);
    return { w: vw * s, h: vh * s, x: (this.W - vw * s) / 2, y: (this.H - vh * s) / 2 };
  }

  map(nx, ny) {
    const r = this.videoRect();
    return { x: r.x + (1 - nx) * r.w, y: r.y + ny * r.h };
  }

  async init() {
    const q = this.quality;
    if (this.useWorker) {
      try {
        this.engine = new WorkerEngine();
        await this.engine.init({ model: q.model, masks: q.masks });
      } catch (e) {
        console.warn('pose worker unavailable, tracking on the main thread', e);
        this.engine?.close();
        this.engine = null;
        this.useWorker = false;
      }
    }
    if (this.engine?.delegate === 'CPU') {
      // Some browsers can't use the graphics chip from a worker, and the model on the processor is many
      // times slower (that was a second of lag a frame). If the main thread gets the graphics chip, track there.
      try {
        const main = new MainThreadEngine();
        await main.init({ model: q.model, masks: q.masks });
        if (main.delegate === 'GPU') {
          console.warn('the pose worker has no graphics chip, tracking on the main thread');
          this.engine.close();
          this.engine = main;
          this.useWorker = false;
        } else main.close();
      } catch (e) {
        console.warn(e);
      }
    }
    if (!this.engine) {
      this.engine = new MainThreadEngine();
      await this.engine.init({ model: q.model, masks: q.masks });
    }
    this.delegate = this.engine.delegate;
  }

  // Keeps an eye on how long tracking takes (ms per frame, at time `now` in seconds). After a short warm-up
  // and ~3 s of measuring: too slow, step down the ladder (full -> lite model, then a smaller frame, then no
  // silhouettes); comfortably fast for a long while, step back up. One step at a time, with the measurement
  // restarted after each, so it can't oscillate. Still too slow at the bottom of the ladder while tracking
  // in the worker: try the main thread instead (see _leaveWorker).
  _watchSpeed(ms, now) {
    this.frames++;
    this.watchStart ??= now;
    if (now - this.watchStart < WARMUP_S || this.frames <= 2) return;
    this.measureStart ??= now;
    this.speedSum += ms;
    this.measured++;
    if (ms < FAST_MS) this.fastSince ??= now;
    else this.fastSince = null;
    const avg = this.speedSum / this.measured;
    const slow = now - this.measureStart >= MEASURE_S && this.measured >= 3 && avg > SLOW_MS;
    const free = !this.qualityPinned && !this.pinned; // ?model= / ?quality= pin it (the e2e tests do)
    if (slow && this.level < QUALITY.length - 1 && !this.qualityPinned && this._setLevel(this.level + 1)) {
      console.warn(`tracking averages ${avg.toFixed(0)}ms/frame, stepped down to ${this.quality.name}`);
    } else if (slow && free && this.level === QUALITY.length - 1 && this.useWorker && !this.triedMainThread) {
      console.warn(`tracking in the worker still averages ${avg.toFixed(0)}ms/frame, trying the main thread`);
      this.triedMainThread = true;
      this._leaveWorker();
    } else if (this.fastSince !== null && now - this.fastSince >= FAST_S && this.level > 0) {
      this._setLevel(this.level - 1);
    } else return;
    this._restartWatch();
  }

  _restartWatch() {
    this.frames = 0;
    this.measured = 0;
    this.speedSum = 0;
    this.watchStart = null;
    this.measureStart = null;
    this.fastSince = null;
  }

  // Move to another rung of the ladder, unless the model or the whole ladder is pinned.
  _setLevel(level) {
    if (this.qualityPinned) return false;
    const from = this.quality;
    const to = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, level))];
    if (this.pinned && to.model !== from.model) return false;
    this.level = QUALITY.indexOf(to);
    if (to.model !== from.model || to.masks !== from.masks) this._switchModel(to.model, to.masks);
    return true;
  }

  async _switchModel(name, masks = this.quality.masks) {
    this.switching = true;
    try {
      await this.engine.setModel({ model: name, masks });
    } catch (e) {
      console.error('model switch failed', e);
    } finally {
      this.switching = false;
    }
  }

  // Opens a camera. deviceId = a specific camera (falls back to the default one if it has gone away);
  // mode = 'wide' (full field of view, 1280x720) or 'standard' (640x480).
  startCamera(opts = {}) {
    return this._queue(() => this._startCamera(opts));
  }

  // Camera operations (start, switch, the slow-camera fallback) run strictly one after another, so two of
  // them can never fight over the camera, however the keys are pressed or whatever the timing.
  _queue(fn) {
    const run = this._camQueue.then(fn, fn);
    this._camQueue = run.catch(() => {});
    return run;
  }

  async _startCamera({ deviceId = null, mode = this.mode, facingMode = 'user' } = {}) {
    this.stopCamera();
    let stream;
    try {
      stream = await this._getStream(cameraConstraints({ deviceId, mode, facingMode }));
    } catch (e) {
      if (!deviceId) throw e;
      console.warn('that camera is unavailable, using the default one', e);
      stream = await this._getStream(cameraConstraints({ mode, facingMode }));
    }
    const track = stream.getVideoTracks()[0];
    this.mode = mode;
    this.facingMode = track?.getSettings?.().facingMode || facingMode;
    this.deviceId = track?.getSettings?.().deviceId ?? deviceId;
    this.cameraLabel = track?.label || 'camera';
    this.video.srcObject = stream;
    await this.video.play();
    // a new picture: forget the old kids and masks (the size may differ)
    this.people.reset();
    this.players = [];
    this.maskLow = null;
    this.lastVideoTime = -1;
    await this.refreshCameras();
    this._watchCameraFps();
  }

  _getStream(constraints) {
    return withRetry(() => navigator.mediaDevices.getUserMedia(constraints), { delayMs: this.retryDelayMs });
  }

  stopCamera() {
    const stream = /** @type {MediaStream | null} */ (this.video.srcObject);
    stream?.getTracks().forEach((t) => t.stop());
    this.fpsGuard = null;
  }

  // All cameras the browser knows about (labels only appear after permission has been given).
  async refreshCameras() {
    try {
      this.cameras = await navigator.mediaDevices.enumerateDevices();
    } catch {
      this.cameras = [];
    }
    return this.cameras;
  }

  get cameraCount() {
    return this.cameras.filter((d) => d.kind === 'videoinput' && d.deviceId).length;
  }

  // Switch to the next camera (e.g. a phone webcam app). Returns a description, or null if there is only one.
  nextCamera() {
    return this._queue(() => this._nextCamera());
  }

  async _nextCamera() {
    await this.refreshCameras();
    let id = nextCameraId(this.cameras, this.deviceId);
    if (!id) {
      // Some systems leave the camera that is in use out of the list. Release it and look again; if there
      // really is only one camera, carry on with that one.
      const current = this.deviceId;
      this.stopCamera();
      // the list can be empty for a moment right after a camera is released, so look a few times
      for (let tries = 0; tries < 4; tries++) {
        await this.refreshCameras();
        if (this.cameraCount > 0) break;
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
      id = nextCameraId(this.cameras, current);
      if (!id) {
        await this._startCamera({ deviceId: current });
        return null;
      }
    }
    const previous = this.deviceId;
    try {
      await this._startCamera({ deviceId: id });
    } catch (e) {
      // never leave the game without a picture: put the old camera back, then report the problem
      console.warn('could not switch camera, going back to the previous one', e);
      await this._startCamera({ deviceId: previous }).catch((err) => console.error('could not restore the camera either', err));
      throw e;
    }
    saveCamera(globalThis.localStorage, this.deviceId);
    return describeCamera(this.cameras, this.deviceId, this.cameraLabel);
  }

  // A camera that can't keep up at 720p (common with cheap webcams) makes everything feel laggy, so if it
  // delivers fewer than ~15 frames a second we quietly ask for 640x480 instead.
  _watchCameraFps() {
    if (!this.video.requestVideoFrameCallback) return;
    const guard = (this.fpsGuard = new FpsGuard());
    const tick = (now, meta) => {
      if (this.fpsGuard !== guard) return; // camera was switched meanwhile
      // presentedFrames counts what the camera really delivered, even if a busy page missed some callbacks
      // (a slow laptop must not make a healthy camera look slow); older browsers fall back to counting callbacks
      if (Number.isFinite(meta?.presentedFrames)) guard.sample(now / 1000, meta.presentedFrames);
      else guard.frame(now / 1000);
      this.cameraFps = guard.fps;
      const verdict = guard.verdict();
      if (verdict === 'slow' && this.mode === 'wide' && !this.modePinned) {
        console.warn(`camera only delivers ${guard.fps.toFixed(0)} fps at 720p, switching to 640x480`);
        this._queue(async () => {
          if (this.fpsGuard !== guard) return; // the camera was changed while this waited its turn
          await this._startCamera({ deviceId: this.deviceId, mode: 'standard' });
        }).catch((e) => console.error(e));
        return;
      }
      if (verdict === 'pending') this.video.requestVideoFrameCallback(tick);
    };
    this.video.requestVideoFrameCallback(tick);
  }

  // true if the camera picture is upright (a phone held the wrong way round): the view is narrow and tall
  get isPortrait() {
    return this.video.videoHeight > this.video.videoWidth && this.video.videoWidth > 0;
  }

  // Called every drawn frame. Tracking runs at its own pace: a new camera frame is sent off whenever the
  // previous one has been answered, and whatever answer arrived since last time is applied. With the worker
  // engine the game keeps drawing while a frame is tracked; on the main thread this blocks as before.
  update(now) {
    const v = this.video;
    if (this.engine && !this.switching && !this.inflight && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const q = this.quality;
      const sent = performance.now();
      this.inflight = this.engine
        .detect(v, sent, { scale: q.scale, maskW: this.maskW })
        .then((res) => {
          // the whole round trip (frame copy, the worker, the answer coming back), not just the model's share
          if (res) this.latest = { ...res, ms: Math.max(res.ms, performance.now() - sent) };
          this.failures = 0;
        })
        .catch((e) => {
          console.error('detect failed', e);
          this.failures = (this.failures ?? 0) + 1;
          if (this.useWorker && this.failures >= 3) this._leaveWorker();
          else if (this.delegate === 'GPU' && !this.useWorker) this._fallbackToCpu();
        })
        .finally(() => (this.inflight = null));
    }
    if (this.latest) {
      const res = this.latest;
      this.latest = null;
      this.detectMs = this.detectMs * 0.9 + res.ms * 0.1;
      this._watchSpeed(res.ms, now);
      if (this.simulateLost) this._apply({ landmarks: [], looks: [], mask: null, maskW: res.maskW, maskH: res.maskH }, now);
      else this._apply(res, now);
    }
    this.players = this.people.tick(now);
    return this.players;
  }

  _apply(res, now) {
    this.frameSeq++;
    // the merged silhouettes: keep the array when the model found nobody so the cut-out can fade them out
    if (res.mask) {
      this.maskLow = res.mask;
      this.maskH = res.maskH;
    } else {
      if (this.maskLow && this.maskLow.length === this.maskW * this.maskH) this.maskLow.fill(0);
      else if (this.video.videoWidth) {
        this.maskH = Math.round((this.maskW * this.video.videoHeight) / this.video.videoWidth);
        this.maskLow = new Float32Array(this.maskW * this.maskH);
      }
      // no silhouettes from the model (the cheapest quality rung): draw rough ones from the skeletons
      if (this.maskLow) skeletonMaskInto(res.landmarks, this.maskLow, this.maskW, this.maskH);
    }
    this._ingest(res.landmarks, res.looks || [], now);
  }

  // The worker keeps failing (a crashed GPU context, a browser quirk): carry on tracking on the main thread.
  async _leaveWorker() {
    console.warn('pose worker keeps failing, tracking on the main thread');
    this.switching = true;
    try {
      this.engine.close();
      this.useWorker = false;
      const engine = new MainThreadEngine();
      await engine.init({ model: this.quality.model, masks: this.quality.masks });
      this.engine = engine;
      this.delegate = engine.delegate;
      this.failures = 0;
    } catch (e) {
      console.error('could not start tracking on the main thread either', e);
    } finally {
      this.switching = false;
    }
  }

  async _fallbackToCpu() {
    this.delegate = 'CPU';
    try {
      await this.engine.fallbackToCpu(this.quality.model, this.quality.masks);
    } catch (e) {
      console.error(e);
    }
  }

  _ingest(all, looks, now) {
    const dets = [];
    all.forEach((lm, i) => {
      if ((lm[11].visibility + lm[12].visibility) / 2 < 0.3) return;
      const px = lm.map((l) => this.map(l.x, l.y));
      dets.push({ px, vis: lm.map((l) => l.visibility), look: looks[i] ?? null });
    });
    for (const [p, d] of this.people.match(dets, now)) {
      // Steady the skeleton: heavy smoothing on joints that are nearly still (kills jitter), light on
      // fast ones (keeps waving and jumping instant). Joints the model is unsure about (hidden or
      // blurry, e.g. a small kid's hips) hold their last position instead of jumping around.
      p.filters ??= Array.from({ length: 33 }, () => ({ x: new OneEuro(), y: new OneEuro() }));
      p.px = d.px.map((n, i) =>
        p.px && d.vis[i] < 0.25 ? p.px[i] : { x: p.filters[i].x.filter(n.x, now), y: p.filters[i].y.filter(n.y, now) },
      );
      computeFeatures(p, now);
    }
  }
}

// Fallback / testing: the mouse is one kid. Mouse = body + hands, button = jump,
// Q / W / E = arms up / airplane / hands on head, S = duck. Moving the mouse is motion.
export class MouseTracker {
  constructor(canvas) {
    this.players = [];
    this.W = 1280;
    this.H = 720;
    this.pos = { x: 640, y: 300 };
    this.down = false;
    this.keys = new Set();
    this.player = /** @type {Player} */ ({ id: 1, slot: 0, color: COLORS[0], px: null, present: true, seen: 0, score: 0, jumps: 0, lastJump: -99, lastDuck: -99, motion: 0, hitUntil: 0, pose: {}, hands: [], circles: [], sh: { x: 0, y: 0 }, hip: { x: 0, y: 0 }, cx: 0, shoulderW: 0, torso: 0 });
    this.detectMs = 0;
    this.delegate = 'mouse';
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.pos = { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
    });
    canvas.addEventListener('pointerdown', () => (this.down = true));
    window.addEventListener('pointerup', () => (this.down = false));
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  setView(W, H) {
    this.W = W;
    this.H = H;
  }

  videoRect() {
    return null;
  }

  update(now) {
    const u = this.H / 1080;
    const { x, y } = this.pos;
    const px = Array.from({ length: 33 }, () => ({ x, y }));
    px[0] = { x, y: y - 110 * u };
    px[11] = { x: x - 70 * u, y };
    px[12] = { x: x + 70 * u, y };
    px[13] = { x: x - 110 * u, y: y + 90 * u };
    px[14] = { x: x + 110 * u, y: y + 90 * u };
    px[23] = { x: x - 50 * u, y: y + 170 * u };
    px[24] = { x: x + 50 * u, y: y + 170 * u };
    px[25] = { x: x - 50 * u, y: y + 330 * u };
    px[26] = { x: x + 50 * u, y: y + 330 * u };
    px[27] = { x: x - 50 * u, y: y + 480 * u };
    px[28] = { x: x + 50 * u, y: y + 480 * u };
    const p = this.player;
    p.px = px;
    p.seen = now;
    p.present = true;
    computeFeatures(p, now, { skipJump: true });
    if (this.down) p.lastJump = now;
    p.pose = { armsUp: this.keys.has('q'), airplane: this.keys.has('w'), handsHead: this.keys.has('e'), duck: this.keys.has('s') };
    if (p.pose.duck) p.lastDuck = now;
    this.players = [p];
    return this.players;
  }
}
