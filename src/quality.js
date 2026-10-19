// Pure: the tracking quality ladder. Which rung to track on (model, frame size, silhouettes), and when to move:
// step down when tracking is slow, back up after a long fast spell. PoseTracker (tracker.js) feeds it the round
// trip of every tracked frame and does what it says (switch the model, leave the worker).

// If tracking averages slower than this per frame, step down the quality ladder.
// Measured from sending a frame to getting its answer back, which is the delay the kids actually see.
export const SLOW_MS = 50;
// ...and if it averages faster than this for a long while, step back up.
export const FAST_MS = 20;
// The ladder works in seconds, not frames: on a machine tracking 2 frames a second, "90 frames" was
// 45 s per step, minutes of lag before it got anywhere near a speed that works.
export const WARMUP_S = 1; // the first frames after a start or a switch are always slow (shaders compile)
export const MEASURE_S = 3; // how long to average before stepping down
export const FAST_S = 20; // how long it must stay fast before stepping back up

/** @typedef {{ name: string, model: 'full' | 'lite', scale: number, masks: boolean }} Rung */

// The quality ladder, best first. Each step is cheaper than the one before:
//   model:  'full' is noticeably better on children; 'lite' is about twice as fast
//   scale:  the camera frame is shrunk by this before tracking (landmarks are normalised, so nothing else changes)
//   masks:  the person silhouettes for the cut-out cost ~6-9 ms a frame; without them the cut-out runs on motion alone
/** @type {Rung[]} */
export const QUALITY = [
  { name: 'high', model: 'full', scale: 1, masks: true },
  { name: 'medium', model: 'lite', scale: 1, masks: true },
  { name: 'low', model: 'lite', scale: 0.5, masks: true },
  { name: 'lowest', model: 'lite', scale: 0.5, masks: false },
];

/**
 * What the ladder decided after a tracked frame.
 * @typedef {{ type: 'down' | 'up', from: Rung, to: Rung, avg: number } | { type: 'leave-worker', avg: number } | null} LadderMove
 */

export class QualityLadder {
  // model: 'lite' | 'full' pins the model (?model=): the ladder never switches it. Anything else is ignored.
  // quality: a QUALITY name pins the whole ladder (?quality=). startQuality: where to start when not pinned.
  /** @param {{ model?: string | null, quality?: string | null, startQuality?: string }} [opts] */
  constructor({ model, quality, startQuality = 'high' } = {}) {
    const pinnedModel = model === 'lite' || model === 'full' ? model : null;
    this.pinned = !!pinnedModel; // explicit model choice: never auto-switch the model
    this.qualityPinned = QUALITY.some((q) => q.name === quality);
    let level = QUALITY.findIndex((q) => q.name === (this.qualityPinned ? quality : startQuality));
    if (level < 0) level = 0;
    if (pinnedModel) level = QUALITY.findIndex((q) => q.model === pinnedModel);
    this.level = level;
    this.restart();
  }

  /** The rung in use. */
  get quality() {
    return QUALITY[this.level];
  }

  // Start measuring afresh (after a step, or when the engine changes).
  restart() {
    this.frames = 0;
    this.measured = 0;
    this.speedSum = 0;
    /** @type {number | null} */ this.watchStart = null;
    /** @type {number | null} */ this.measureStart = null;
    /** @type {number | null} */ this.fastSince = null;
  }

  /**
   * One tracked frame took `ms` (round trip), at time `now` in seconds. After a short warm-up and ~3 s of
   * measuring: too slow, step down the ladder (full -> lite model, then a smaller frame, then no silhouettes);
   * comfortably fast for a long while, step back up. One step at a time, with the measurement restarted after
   * each, so it can't oscillate. Still too slow at the bottom while `canLeaveWorker`: say to try the main thread.
   * @param {number} ms  @param {number} now  @param {boolean} [canLeaveWorker]
   * @returns {LadderMove}
   */
  watch(ms, now, canLeaveWorker = false) {
    this.frames++;
    this.watchStart ??= now;
    if (now - this.watchStart < WARMUP_S || this.frames <= 2) return null;
    this.measureStart ??= now;
    this.speedSum += ms;
    this.measured++;
    if (ms < FAST_MS) this.fastSince ??= now;
    else this.fastSince = null;
    const avg = this.speedSum / this.measured;
    const slow = now - this.measureStart >= MEASURE_S && this.measured >= 3 && avg > SLOW_MS;
    const free = !this.qualityPinned && !this.pinned; // ?model= / ?quality= pin it (the e2e tests do)
    /** @type {LadderMove} */
    let move = null;
    const down = slow && this.level < QUALITY.length - 1 ? this.step(this.level + 1) : null;
    if (down) {
      move = { type: 'down', ...down, avg };
    } else if (slow && free && this.level === QUALITY.length - 1 && canLeaveWorker) {
      move = { type: 'leave-worker', avg };
    } else if (this.fastSince !== null && now - this.fastSince >= FAST_S && this.level > 0) {
      const up = this.step(this.level - 1);
      move = up && { type: 'up', ...up, avg };
      if (!move) this.restart(); // a pinned model can't go up: measure afresh, as before
    } else return null;
    if (move) this.restart();
    return move;
  }

  /**
   * Move to another rung, unless the model or the whole ladder is pinned. Returns the rungs, or null if it can't.
   * @param {number} level
   * @returns {{ from: Rung, to: Rung } | null}
   */
  step(level) {
    if (this.qualityPinned) return null;
    const from = this.quality;
    const to = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, level))];
    if (this.pinned && to.model !== from.model) return null;
    this.level = QUALITY.indexOf(to);
    return { from, to };
  }
}
