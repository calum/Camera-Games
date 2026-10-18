// Turns camera frames (or the mouse) into "players" the game can use.
//
// A player looks like:
//   { id, color, present, px[33] (screen-space landmarks), hands[], circles[],
//     sh, hip, cx, shoulderW, torso, lastJump, jumps, pose:{armsUp,airplane,handsHead}, score }
// Levels only ever read those fields, so any tracker (camera, mouse, a different
// model, a Pi build) can be swapped in without touching the game.

import { OneEuro } from './filter.js';
import { downsampleMaxInto } from './person-mask.js';

export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

export const COLORS = ['#ff4d6d', '#4dd0ff', '#ffd24d', '#7dff6b', '#c77dff', '#ff9a3d'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Derive everything the game needs from the 33 screen-space landmarks in p.px.
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
}

function newPlayer(id, slot) {
  return {
    id,
    slot,
    color: COLORS[slot % COLORS.length],
    px: null,
    present: true,
    seen: 0,
    score: 0,
    jumps: 0,
    lastJump: -99,
    wasJump: false,
    pose: {},
    hitUntil: 0,
  };
}

// If the bigger model averages slower than this per frame, drop to the lite one (see _watchSpeed).
const SLOW_MS = 50;

export class PoseTracker {
  // model: 'lite' | 'full'. Not given = start with the more accurate 'full' model (noticeably better
  // on children) and fall back to 'lite' automatically on a slow machine.
  constructor({ model } = {}) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.players = [];
    this.nextId = 1;
    this.lastVideoTime = -1;
    this.detectMs = 0;
    this.delegate = '?';
    this.landmarker = null;
    this.pinned = model === 'lite' || model === 'full'; // explicit choice: never auto-switch
    this.modelName = this.pinned ? model : 'full';
    this.frames = 0;
    this.speedSum = 0;
    this.switching = false;
    // The pose model also outputs a silhouette per person. We shrink them (all people OR-ed together)
    // into one small array that the cut-out logic (person-mask.js) uses. null until the camera is up.
    this.maskW = 256;
    this.maskH = 192;
    this.maskLow = null;
    this.W = 1280;
    this.H = 720;
  }

  setView(W, H) {
    this.W = W;
    this.H = H;
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
    const { FilesetResolver, PoseLandmarker } = await import('../vendor/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('/vendor/wasm');
    // Confidence thresholds are lower than the defaults (0.5): kids are less common in the model's
    // training data, so it is less sure about them and would otherwise drop them for a few frames.
    const make = (delegate, name) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `/models/pose_landmarker_${name}.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 4,
        outputSegmentationMasks: true, // person silhouettes for the cut-out (~6-9ms extra per frame)
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
    this._make = make;
    try {
      this.landmarker = await make('GPU', this.modelName);
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU delegate unavailable, using CPU', e);
      this.landmarker = await make('CPU', this.modelName);
      this.delegate = 'CPU';
    }
  }

  // After ~4s of tracking, if the full model is too slow for this machine, quietly swap to lite.
  _watchSpeed(ms) {
    this.frames++;
    if (this.frames > 30 && this.frames <= 120) this.speedSum += ms; // skip warm-up frames
    if (this.frames === 120 && this.modelName === 'full' && !this.pinned && this.speedSum / 90 > SLOW_MS) {
      console.warn(`full model averages ${(this.speedSum / 90).toFixed(0)}ms/frame, switching to lite`);
      this._switchModel('lite');
    }
  }

  async _switchModel(name) {
    this.switching = true;
    try {
      const next = await this._make(this.delegate, name);
      this.landmarker?.close?.();
      this.landmarker = next;
      this.modelName = name;
    } catch (e) {
      console.error('model switch failed', e);
    } finally {
      this.switching = false;
    }
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
  }

  update(now) {
    const v = this.video;
    if (this.landmarker && !this.switching && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      let res = null;
      try {
        res = this.landmarker.detectForVideo(v, t0);
      } catch (e) {
        console.error('detect failed', e);
        if (this.delegate === 'GPU') this._fallbackToCpu();
      }
      const ms = performance.now() - t0;
      this.detectMs = this.detectMs * 0.9 + ms * 0.1;
      this._watchSpeed(ms);
      if (res) {
        this._readMasks(res);
        this._ingest(res.landmarks, now);
      }
    }
    // A kid stays "present" through brief tracking dropouts (0.6s) so a glitch doesn't remove them
    // from the game; their player record (colour, score, pose progress) is kept for 1.5s.
    this.players = this.players.filter((p) => now - p.seen < 1.5);
    for (const p of this.players) p.present = now - p.seen < 0.6;
    return this.players;
  }

  // Copy this frame's person silhouettes into maskLow (small, all people merged) and release them.
  _readMasks(res) {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw) return;
    const h = Math.round((this.maskW * vh) / vw);
    if (!this.maskLow || this.maskH !== h) {
      this.maskH = h;
      this.maskLow = new Float32Array(this.maskW * h);
    }
    this.maskLow.fill(0);
    for (const m of res.segmentationMasks || []) {
      try {
        downsampleMaxInto(m.getAsFloat32Array(), m.width, m.height, this.maskLow, this.maskW, this.maskH);
      } finally {
        m.close();
      }
    }
  }

  async _fallbackToCpu() {
    this.delegate = 'CPU';
    try {
      this.landmarker = await this._make('CPU', this.modelName);
    } catch (e) {
      console.error(e);
    }
  }

  _ingest(all, now) {
    const dets = [];
    for (const lm of all) {
      if ((lm[11].visibility + lm[12].visibility) / 2 < 0.3) continue;
      const px = lm.map((l) => this.map(l.x, l.y));
      dets.push({ px, vis: lm.map((l) => l.visibility), cx: (px[11].x + px[12].x) / 2 });
    }
    dets.sort((a, b) => a.cx - b.cx);

    const free = new Set(this.players);
    for (const d of dets) {
      // Match to the closest known player so each kid keeps their colour.
      let best = null;
      let bd = Infinity;
      for (const p of free) {
        const dd = Math.abs(p.cx - d.cx);
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      let p;
      if (best && bd < this.W * 0.3) {
        p = best;
        free.delete(p);
      } else {
        const used = new Set(this.players.map((q) => q.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        p = newPlayer(this.nextId++, slot);
        this.players.push(p);
      }
      // Steady the skeleton: heavy smoothing on joints that are nearly still (kills jitter), light on
      // fast ones (keeps waving and jumping instant). Joints the model is unsure about (hidden or
      // blurry, e.g. a small kid's hips) hold their last position instead of jumping around.
      p.filters ??= Array.from({ length: 33 }, () => ({ x: new OneEuro(), y: new OneEuro() }));
      p.px = d.px.map((n, i) =>
        p.px && d.vis[i] < 0.25 ? p.px[i] : { x: p.filters[i].x.filter(n.x, now), y: p.filters[i].y.filter(n.y, now) },
      );
      p.seen = now;
      p.present = true;
      computeFeatures(p, now);
    }
  }
}

// Fallback / testing: the mouse is one kid. Mouse = body + hands, button = jump,
// Q / W / E = arms up / airplane / hands on head.
export class MouseTracker {
  constructor(canvas) {
    this.players = [];
    this.W = 1280;
    this.H = 720;
    this.pos = { x: 640, y: 300 };
    this.down = false;
    this.keys = new Set();
    this.player = newPlayer(1, 0);
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
    p.pose = { armsUp: this.keys.has('q'), airplane: this.keys.has('w'), handsHead: this.keys.has('e') };
    this.players = [p];
    return this.players;
  }
}
