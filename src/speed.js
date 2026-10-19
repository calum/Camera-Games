// Pure: notices when the game runs slowly on this computer, and picks the likeliest fix to suggest in plain words.
// The setup check only looks at the speed once, on the first launch; a laptop that was fine at lunch can lag in the
// evening (unplugged, dimmer light so the camera slows down, more people in view, other apps open). main.js feeds
// SpeedWatch every drawn frame and shows speedAdvice() on the join screen and the picker while it is slow.

// Slow: fewer tracked frames (or drawn frames) a second than this, for `for` seconds in a row. Calum's laptop
// tracks 15-24 a second when all is well; under 10 the kids see their moves land late.
export const SLOW = { tracked: 10, drawn: 15, for: 6 };
// ...and fine again after `for` seconds above these (a gap between the two, so the note doesn't flicker).
export const FINE = { tracked: 13, drawn: 20, for: 15 };
const WINDOW_S = 1; // rates are counted over one-second windows
const GAP_S = 2; // a longer gap between frames is a sleeping tab or a hidden window, not lag

export class SpeedWatch {
  constructor() {
    this.slow = false;
    this.reset();
  }

  // Start counting afresh (after a gap, a camera switch, or when tracking restarts).
  reset() {
    /** @type {number | null} */ this.start = null;
    /** @type {number | null} */ this.last = null;
    this.seq0 = 0;
    this.frames = 0;
    this.bodySum = 0;
    this.badFor = 0;
    this.goodFor = 0;
    this.tracked = 0; // the last window's tracked frames a second
    this.drawn = 0; // ...drawn frames a second
    this.bodies = 0; // ...average number of people the pose model found
  }

  /**
   * Call once per drawn frame.
   * @param {number} now  seconds
   * @param {number} seq  tracked frames so far (the tracker's frameSeq)
   * @param {number} bodies  people the pose model found in its last answer
   * @returns {boolean} true on the frame it turns slow (for a one-off note)
   */
  update(now, seq, bodies) {
    if (this.last !== null && (now - this.last > GAP_S || seq < this.seq0)) this.reset();
    this.last = now;
    if (this.start === null) {
      this.start = now;
      this.seq0 = seq;
      return false;
    }
    this.frames++;
    this.bodySum += bodies;
    const span = now - this.start;
    if (span < WINDOW_S) return false;
    this.tracked = (seq - this.seq0) / span;
    this.drawn = this.frames / span;
    this.bodies = this.bodySum / this.frames;
    const bad = this.tracked < SLOW.tracked || this.drawn < SLOW.drawn;
    const good = this.tracked >= FINE.tracked && this.drawn >= FINE.drawn;
    this.badFor = bad ? this.badFor + span : 0;
    this.goodFor = good ? this.goodFor + span : 0;
    this.start = now;
    this.seq0 = seq;
    this.frames = 0;
    this.bodySum = 0;
    if (this.slow && this.goodFor >= FINE.for) this.slow = false;
    if (!this.slow && this.badFor >= SLOW.for) return (this.slow = true);
    return false;
  }
}

/**
 * What the computer tells us about itself. Browsers don't show how busy the processor is or how much memory is
 * free, but Edge and Chrome do say whether a laptop is on battery, how many cores and roughly how much memory it
 * has, and (Compute Pressure) whether the processor is working flat out.
 * @typedef {Object} Computer
 * @property {boolean} [software]  graphics acceleration is off (setup-check.js softwareRendering)
 * @property {string} [accelerationHelp]  where to turn it on, in this browser
 * @property {boolean | null} [charging]  false: a laptop on battery. null: unknown
 * @property {number} [cameraFps]  frames a second the camera delivers (0 while measuring)
 * @property {string | null} [pressure]  the processor: 'nominal' | 'fair' | 'serious' | 'critical'. null: unknown
 * @property {number} [bodies]  people the pose model is tracking
 * @property {number} [cores]  processor cores (navigator.hardwareConcurrency)
 * @property {number} [memoryGB]  roughly (navigator.deviceMemory, at most 8)
 */

/**
 * The one thing most likely to help, for a grown-up glancing at the TV, checked in order of how much each helps.
 * `tip` is what to do (short enough for a note in the middle of the screen); `why` says why, or where.
 * @param {Computer} c
 * @returns {{ tip: string, why: string }}
 */
export function speedAdvice(c) {
  const say = (tip, why = '') => ({ tip: `Running slowly: ${tip}`, why });
  if (c.software) return say('turn on graphics acceleration.', c.accelerationHelp ?? '');
  if (c.charging === false) return say('plug the laptop in.', 'On battery it slows itself down to save power.');
  if (c.cameraFps && c.cameraFps < 15) return say('turn on more lights.', 'The camera slows down in dim light.');
  if (c.pressure === 'serious' || c.pressure === 'critical') return say('close other tabs and apps.', 'The computer is working flat out.');
  const people = Math.round(c.bodies ?? 0);
  if (people >= 3) return say('anyone watching, sit out of the picture.', `The camera sees ${people} people, and each one takes tracking time.`);
  if ((c.cores && c.cores <= 4) || (c.memoryGB && c.memoryGB <= 4)) return say('close other tabs and apps.', 'This computer is on the slow side.');
  if (people === 2) return say('close other tabs and apps.', 'Two players take more tracking time than one.');
  return say('close other tabs and apps, and plug the laptop in.');
}

/** @param {{ tip: string, why: string }} a */
export const adviceText = (a) => `${a.tip} ${a.why}`.trim();
