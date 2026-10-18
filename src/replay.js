// Plays a debug recording (recording.js) back as if it were the camera: the recorded tracking answers go through
// the same who-is-who, smoothing and pose code as a live game (ingestLandmarks), at the pace they were recorded.
// The game uses it with ?replay (drop a file on the page, or press L); the unit tests use playRecording() to
// turn real footage into regression tests. No DOM.
/** @import { Player } from './types.js' */
/** @import { Recording } from './recording.js' */
import { ingestLandmarks } from './tracker.js';
import { People } from './people.js';
import { unpackLandmarks } from './recording.js';

export class ReplayTracker {
  /** @param {Recording} rec */
  constructor(rec) {
    this.rec = rec;
    this.people = new People();
    /** @type {Player[]} */ this.players = [];
    this.W = 1280;
    this.H = 720;
    this.detectMs = 0;
    this.delegate = 'replay';
    this.i = 0; // the next frame to apply
    this.offset = 0; // game time - recorded time
    this.started = false;
  }

  get done() {
    return this.i >= this.rec.frames.length;
  }

  // How far through the clip (0..1)
  get progress() {
    const f = this.rec.frames;
    if (!f.length || !this.started) return 0;
    return Math.min(1, (this.i ? f[this.i - 1].t - f[0].t : 0) / Math.max(1e-6, f.at(-1).t - f[0].t));
  }

  setView(W, H) {
    this.W = W;
    this.H = H;
    this.people.setView(W);
  }

  videoRect() {
    return null;
  }

  // Where the (mirrored, cover-fitted) camera picture of size vw x vh sat on this screen: as PoseTracker.map
  map(nx, ny, vw, vh) {
    const s = Math.max(this.W / vw, this.H / vh);
    const w = vw * s;
    const h = vh * s;
    return { x: (this.W - w) / 2 + (1 - nx) * w, y: (this.H - h) / 2 + ny * h };
  }

  /** @param {number} now */
  update(now) {
    const frames = this.rec.frames;
    if (!this.started && frames.length) {
      this.started = true;
      this.offset = now - frames[0].t;
    }
    // every frame that is due (several at once if drawing is slower than the recording was)
    while (this.i < frames.length && frames[this.i].t + this.offset <= now) {
      const f = frames[this.i++];
      const t = f.t + this.offset;
      const [vw, vh] = f.v ?? [1280, 720];
      if (this.i > 1) this.detectMs = this.detectMs * 0.9 + (f.t - frames[this.i - 2].t) * 100;
      ingestLandmarks(this.people, (x, y) => this.map(x, y, vw, vh), f.lm.map(unpackLandmarks), f.looks ?? [], t);
    }
    this.players = this.people.tick(now);
    return this.players;
  }
}

/**
 * Play a whole recording without a screen and say what the game would have seen every `step` seconds.
 * @param {Recording} rec
 * @param {{ W?: number, H?: number, step?: number, tail?: number }} [opts]  tail: keep going this long after the last frame
 * @returns {{ t: number, players: { id: number, x: number, pose: string[] }[] }[]}
 */
export function playRecording(rec, { W = 1920, H = 1080, step = 1 / 60, tail = 1 } = {}) {
  const r = new ReplayTracker(rec);
  r.setView(W, H);
  const out = [];
  if (!rec.frames.length) return out;
  const t0 = rec.frames[0].t;
  const end = rec.frames.at(-1).t - t0 + tail;
  for (let t = 0; t <= end + 1e-9; t += step) {
    const players = r.update(t0 + t);
    out.push({ t, players: players.map((p) => ({ id: p.id, x: p.cx, pose: Object.keys(p.pose ?? {}).filter((k) => p.pose[k]) })) });
  }
  return out;
}
