// The setup check on first launch: about 10 seconds that look at the camera, the lighting, how far away the kids
// stand and how fast the laptop tracks, and tell the grown-up in plain words what to fix. Pure (no DOM): main.js
// feeds it measurements and draws what it says. Once everything has passed it is remembered and not shown again
// (?setup shows it again). A grown-up can skip it at any time.

/** @import { Player } from './types.js' */

export const SETUP_KEY = 'kcg.setupDone';

export function setupDone(storage) {
  try {
    return storage?.getItem(SETUP_KEY) === '1';
  } catch {
    return false; // storage blocked (private mode etc.): just show it
  }
}
export function saveSetupDone(storage) {
  try {
    storage.setItem(SETUP_KEY, '1');
  } catch {
    /* not worth failing over */
  }
}

/** @param {URLSearchParams} params */
export const shouldRunSetup = (params, storage) => params.has('setup') || (!params.has('nosetup') && !params.has('level') && !setupDone(storage));

// Average brightness (0 = black, 1 = white) of an RGBA picture, e.g. a tiny copy of the camera frame.
/** @param {ArrayLike<number>} rgba */
export function frameBrightness(rgba) {
  let sum = 0;
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n * 4; i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return n ? sum / n / 255 : 0;
}

// Each check gives { ok, text }: ok = true (fine), false (needs fixing), null (still measuring).
// The words are for a parent glancing at the TV, so they say what to do, not what is wrong.

export const SPEED = { slowMs: 250, minFps: 12, frames: 5 };
export const LIGHT = { dark: 0.2, bright: 0.85 };
/** @param {number | null} brightness */
export function judgeLight(brightness) {
  if (brightness === null) return { ok: null, text: 'Checking the light...' };
  if (brightness < LIGHT.dark) return { ok: false, text: 'Too dark: turn on a light or open the curtains' };
  if (brightness > LIGHT.bright) return { ok: false, text: 'Too bright: avoid standing in front of a sunny window' };
  return { ok: true, text: 'Light is good' };
}

// How far away: the whole body (head to feet) should be in the picture, but not so far that the kid is tiny.
// Sizes are shoulder widths compared to the screen width (poses are measured in shoulder widths, see CLAUDE.md).
export const DISTANCE = { near: 0.25, far: 0.035 };
/**
 * @param {Player[]} players  the kids in view
 * @param {number} W
 * @param {number} H
 * @param {number} [tracked]  frames tracked so far: nobody found in the first few is not yet a fault
 */
export function judgeDistance(players, W, H, tracked = Infinity) {
  if (!players.length && tracked < SPEED.frames * 2) return { ok: null, text: 'Looking for you...' };
  if (!players.length) return { ok: false, text: 'Step in front of the camera' };
  for (const p of players) {
    const top = Math.min(p.px[0].y, p.px[11].y, p.px[12].y);
    const feet = Math.max(p.px[27].y, p.px[28].y);
    if (p.shoulderW > DISTANCE.near * W || feet > H * 0.98 || top < H * 0.02) return { ok: false, text: 'Step back a little, so the camera sees you from head to toe' };
    if (p.shoulderW < DISTANCE.far * W) return { ok: false, text: 'Come a little closer to the camera' };
  }
  return { ok: true, text: players.length > 1 ? `${players.length} players, all in view` : 'You are in view, head to toe' };
}

/**
 * @param {number} detectMs  the usual tracking round trip
 * @param {number} cameraFps  0 while still measuring
 * @param {number} tracked  frames tracked so far
 */
export function judgeSpeed(detectMs, cameraFps, tracked) {
  if (tracked < SPEED.frames) return { ok: null, text: 'Checking the speed...' };
  if (detectMs > SPEED.slowMs) return { ok: false, text: 'A bit slow: close other tabs and apps, and plug the laptop in' };
  if (cameraFps > 0 && cameraFps < SPEED.minFps) return { ok: false, text: 'The camera is slow: more light helps, or press C for another camera' };
  return { ok: true, text: 'Fast enough' };
}

// Graphics acceleration. With it off (a browser setting, or a blocked graphics driver) the browser draws with a
// software renderer and the pose model runs on the processor: many times slower, and the game lags however fast the
// laptop is. The WebGL renderer's name gives it away (SwiftShader is Chrome and Edge's software renderer), and so
// does the pose model having fallen back to the CPU.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|no webgl/i;
/**
 * @param {string} renderer  the WebGL renderer's name ('' if unknown)
 * @param {string} delegate  where the pose model runs: 'GPU' or 'CPU'
 */
export function softwareRendering(renderer, delegate) {
  return SOFTWARE.test(renderer) || delegate === 'CPU';
}
export function judgeGraphics(renderer, delegate) {
  return softwareRendering(renderer, delegate) ? { ok: false, text: 'Graphics acceleration is off: see below' } : { ok: true, text: 'Graphics acceleration is on' };
}
// Where to turn it back on, in the grown-up's own browser.
/** @param {string} userAgent */
export function accelerationHelp(userAgent) {
  if (/Edg\//.test(userAgent)) return 'Edge: Settings > System and performance > turn on "Use graphics acceleration when available", then restart Edge.';
  if (/Chrome\//.test(userAgent)) return 'Chrome: Settings > System > turn on "Use graphics acceleration when available", then relaunch Chrome.';
  return 'Turn on graphics (hardware) acceleration in the browser settings, then restart the browser.';
}

/** @param {boolean} picture  frames are arriving from the camera */
export function judgeCamera(picture, label = '') {
  return picture ? { ok: true, text: label ? `Camera: ${label}` : 'Camera works' } : { ok: false, text: 'No picture: check the camera is plugged in and not used by another app' };
}

// Runs the checks for `duration` seconds. Passes once every check has been fine for `hold` seconds in a row (but
// not before `min` seconds, so the grown-up sees it happen), then `finished` after `celebrate` seconds of "All set!".
// If it hasn't passed in time it keeps checking (so fixing the problem still passes) and offers to carry on anyway.
export class SetupCheck {
  constructor({ duration = 10, hold = 1, min = 3, celebrate = 1.5 } = {}) {
    this.o = { duration, hold, min, celebrate };
    this.t = 0;
    this.okFor = 0;
    this.passedAt = null;
    /** @type {{ name: string, ok: boolean | null, text: string }[]} */
    this.items = [];
  }

  get passed() {
    return this.passedAt !== null;
  }
  get finished() {
    return this.passed && this.t - this.passedAt >= this.o.celebrate;
  }
  // the 10 seconds are up without a pass: show the fixes and how to carry on anyway
  get overdue() {
    return !this.passed && this.t >= this.o.duration;
  }

  /**
   * @param {Record<string, { ok: boolean | null, text: string }>} checks  e.g. { camera, light, distance, speed }
   * @param {number} dt
   */
  update(checks, dt) {
    this.t += dt;
    if (this.passed) return; // keep showing the passing results
    this.items = Object.entries(checks).map(([name, c]) => ({ name, ...c }));
    this.okFor = this.items.every((c) => c.ok === true) ? this.okFor + dt : 0;
    if (this.okFor >= this.o.hold && this.t >= this.o.min) this.passedAt = this.t;
  }
}
