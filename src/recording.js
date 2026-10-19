// Debug recordings: in debug mode (?debug or key D) the game keeps the last minute of play in memory, so a
// grown-up who sees something go wrong can press R and get one file with everything needed to look into it:
// every tracking answer (the raw skeletons, before who-is-who and smoothing), how fast things ran, what the
// game was doing, and what happened (state changes, scores, misses, warnings). replay.js plays it back through
// the real tracking and game code. Pure: no DOM, nothing leaves the computer unless the file is shared.

export const RECORDING_KIND = 'camera-games-recording';
// Recordings saved before the game was renamed (and the fixtures in test/) still load.
const OLD_KINDS = ['kids-camera-games-recording'];
export const RECORDING_VERSION = 1;
export const KEEP_SECONDS = 60;

/**
 * @typedef {object} RecFrame   one tracking answer
 * @property {number} t          game time (s)
 * @property {number[][]} lm     per body: 33 x [x, y, visibility], normalised to the camera picture
 * @property {(number[] | null)[]} looks  per body: clothing colours (look.js), for recalling kids who come back
 * @property {number[]} v        camera picture size [w, h] (to place the skeletons on screen)
 *
 * @typedef {{ t: number } & Record<string, any>} RecSample   how things were running, a few times a second
 * @typedef {{ t: number, type: string } & Record<string, any>} RecEvent
 *
 * @typedef {object} Recording
 * @property {string} kind
 * @property {number} version
 * @property {Record<string, any>} meta   browser, screen, settings, and where the game was when the clip starts
 * @property {RecFrame[]} frames
 * @property {RecSample[]} samples
 * @property {RecEvent[]} events
 */

const round = (n, k) => Math.round(n * k) / k;

/** @param {{ x: number, y: number, visibility?: number }[]} lm  @returns {number[]} */
export function packLandmarks(lm) {
  const out = [];
  // 4 decimals is a fifth of a pixel on a 1080p screen
  for (const l of lm) out.push(round(l.x, 1e4), round(l.y, 1e4), round(l.visibility ?? 1, 100));
  return out;
}

/** @param {number[]} flat  @returns {{ x: number, y: number, z: number, visibility: number }[]} */
export function unpackLandmarks(flat) {
  const out = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1], z: 0, visibility: flat[i + 2] });
  return out;
}

// A rolling buffer: anything older than `seconds` is dropped, so memory stays flat however long the game runs.
export class Recorder {
  constructor({ seconds = KEEP_SECONDS } = {}) {
    this.seconds = seconds;
    /** @type {RecFrame[]} */ this.frames = [];
    /** @type {RecSample[]} */ this.samples = [];
    /** @type {RecEvent[]} */ this.events = [];
  }

  /**
   * @param {number} t
   * @param {{ x: number, y: number, visibility?: number }[][]} landmarks
   * @param {(number[] | null)[] | undefined} looks
   * @param {number} vw  camera picture width
   * @param {number} vh
   */
  frame(t, landmarks, looks, vw, vh) {
    this.frames.push({ t, lm: landmarks.map(packLandmarks), looks: (looks ?? []).map((l) => (l ? l.map((c) => round(c, 1000)) : null)), v: [vw, vh] });
    this._trim(t);
  }

  /** @param {number} t  @param {Record<string, any>} stats */
  sample(t, stats) {
    this.samples.push({ t, ...stats });
    this._trim(t);
  }

  /** @param {number} t  @param {string} type  @param {Record<string, any>} [data] */
  event(t, type, data = {}) {
    this.events.push({ t, type, ...data });
    this._trim(t);
  }

  /** @param {number} now */
  _trim(now) {
    const from = now - this.seconds;
    for (const list of [this.frames, this.samples, this.events]) {
      let n = 0;
      while (n < list.length && list[n].t < from) n++;
      if (n) list.splice(0, n);
    }
  }

  // How many seconds the buffer holds right now
  get span() {
    const all = [this.frames[0], this.samples[0], this.events[0]].filter(Boolean).map((x) => x.t);
    const last = [this.frames.at(-1), this.samples.at(-1), this.events.at(-1)].filter(Boolean).map((x) => x.t);
    return all.length ? Math.max(...last) - Math.min(...all) : 0;
  }

  /** @param {Record<string, any>} meta  @returns {Recording} */
  toFile(meta) {
    return { kind: RECORDING_KIND, version: RECORDING_VERSION, meta, frames: [...this.frames], samples: [...this.samples], events: [...this.events] };
  }
}

/**
 * Read a recording file, with a plain-word error if it isn't one.
 * @param {string} text
 * @returns {Recording}
 */
export function parseRecording(text) {
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    throw new Error('That file is not a game recording (it is not JSON)');
  }
  if (rec?.kind !== RECORDING_KIND && !OLD_KINDS.includes(rec?.kind)) throw new Error('That file is not a game recording');
  if (rec.version > RECORDING_VERSION) throw new Error('That recording is from a newer version of the game');
  if (!Array.isArray(rec.frames)) throw new Error('That recording has no tracking in it');
  rec.samples ??= [];
  rec.events ??= [];
  rec.meta ??= {};
  return rec;
}

/**
 * Where the game was when the clip starts: the last state change at or before the first frame, else the meta.
 * @param {Recording} rec
 * @returns {{ state: string, level: string | null, levelT: number }}
 */
export function recordingStart(rec) {
  const t0 = rec.frames[0]?.t ?? 0;
  const s = rec.samples.find((x) => x.t >= t0) ?? rec.samples[0];
  return { state: s?.state ?? rec.meta.state ?? 'menu', level: s?.level ?? rec.meta.level ?? null, levelT: s?.levelT ?? 0 };
}

// A file name that sorts by time: camera-games-2026-10-18-181605
/** @param {Date} d */
export function recordingName(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `camera-games-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
