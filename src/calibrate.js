// The play space: before the level picker, the kids show the game how far they can really go. A wall, a sofa or
// a table can be in the camera picture while nobody can stand there, and a level that puts a bubble, a treasure
// chest or the safe gap over the sofa asks for the impossible. So on every start the kids walk as far as they can
// to one side, then to the other, while a green "floor" grows under them; what they reached is the play space,
// and the levels keep things to touch, catch or stand in inside it (kit.js: reachX, standX).
//
// Pure (no DOM): main.js feeds it the kids each frame and draws what it says. Everything is in fractions of the
// screen width, so the space survives a window resize.
/** @import { Player } from './types.js' */

/** @typedef {{ x0: number, x1: number, reach0: number, reach1: number }} PlayArea
 *  x0..x1: where a kid's body (the middle of the shoulders) can be; reach0..reach1: where their hands can get to. */

/** @type {PlayArea} */
export const FULL_AREA = { x0: 0, x1: 1, reach0: 0, reach1: 1 };

export const CAL = {
  settle: 1.2, // s with no new ground before a side counts as "as far as I can go"...
  moved: 0.12, // ...once the kids have walked this far (fraction of the width) from where they started
  near: 0.05, // a kid within this of the furthest place found is "out there"
  edge: 0.07, // or reached this close to the edge of the picture (nothing further to find)
  stuck: 5, // s: or stayed put this long, out at the furthest place (they started right against the obstacle)
  giveUp: 12, // s: a kid who doesn't get it (or stands still) never keeps the game waiting longer than this
  minPhase: 1.0, // s each side is shown at least, so the instruction can be read out
  minWidth: 0.3, // the body range is never narrower than this: a kid who stood still mustn't shrink the game
  reachSlack: 0.04, // hands reach a little beyond the furthest place they were seen
  doneTime: 2.2, // s of "this is your play space!" before the picker
};

const STEP = 0.01; // fraction of the width: smaller moves along the edge are jitter, not new ground

export class Calibration {
  constructor() {
    /** @type {'left' | 'right' | 'done'} */
    this.phase = 'left';
    this.t = 0; // s in this phase
    this.calm = 0; // s since the explored range last grew
    this.mark = Infinity; // where this side's explored edge was when it last counted as growing
    this.start = null; // where the kids were when this side began (body centre, the extreme on that side)
    this.lo = Infinity; // explored body range (fractions of the width)
    this.hi = -Infinity;
    this.handLo = Infinity; // explored hand range
    this.handHi = -Infinity;
    this.sides = { left: false, right: false }; // which sides were really measured
    /** @type {Map<number, { lo: number, hi: number, color: string }>} each kid's own explored range, to colour it in */
    this.ranges = new Map();
    this.finished = false;
  }

  /** @param {Player[]} players  the kids playing (local ones: a family guest's room is not this room) @param {number} W @param {number} dt */
  update(players, W, dt) {
    if (this.finished) return;
    this.t += dt;
    let grew = false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of players) {
      if (!p.sh || !(W > 0)) continue;
      const x = p.cx / W;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      this.lo = Math.min(this.lo, x);
      this.hi = Math.max(this.hi, x);
      const r = this.ranges.get(p.id);
      if (r) (r.lo = Math.min(r.lo, x)), (r.hi = Math.max(r.hi, x)), (r.color = p.color);
      else this.ranges.set(p.id, { lo: x, hi: x, color: p.color });
      // new ground on this side is counted in steps (a little hysteresis), so tracking jitter can't keep the
      // side open for ever, but a kid creeping slowly along still counts as moving
      if (this.phase === 'left' && !(this.lo > this.mark - STEP)) (this.mark = this.lo), (grew = true);
      if (this.phase === 'right' && !(this.hi < this.mark + STEP)) (this.mark = this.hi), (grew = true);
      for (const h of p.hands ?? []) {
        if (!h) continue;
        this.handLo = Math.min(this.handLo, h.x / W);
        this.handHi = Math.max(this.handHi, h.x / W);
      }
    }
    if (this.phase === 'done') {
      if (this.t >= CAL.doneTime) this.finished = true;
      return;
    }
    const left = this.phase === 'left';
    const seen = lo <= hi;
    const now = left ? lo : hi; // the furthest kid on this side, this frame
    if (seen && this.start === null) this.start = now;
    const edge = left ? this.lo : this.hi;
    // "As far as I can go" = a kid is out at the furthest place found so far and it has stopped growing. Walking
    // back across ground already explored (from the left side to the right) doesn't count as standing still.
    const there = seen && Math.abs(now - edge) < CAL.near;
    this.calm = grew || !there ? 0 : this.calm + dt;
    const walked = seen && this.start !== null && Math.abs(now - this.start) >= CAL.moved;
    const atEdge = there && (left ? edge <= CAL.edge : edge >= 1 - CAL.edge);
    // a kid who can't go any further that way (they started against the sofa) is believed after a few seconds
    const settled = this.t >= CAL.minPhase && (atEdge || (this.calm >= CAL.settle && (walked || this.t >= CAL.stuck)));
    if (settled || this.t >= CAL.giveUp) {
      // a side counts as measured only if somebody was really out there; otherwise it stays open (the full width)
      if (settled) this.sides[this.phase] = true;
      this.next(left ? 'right' : 'done');
    }
  }

  /** @param {'left' | 'right' | 'done'} phase */
  next(phase) {
    this.phase = phase;
    this.t = 0;
    this.calm = 0;
    this.start = null;
    this.mark = phase === 'left' ? Infinity : phase === 'right' ? this.hi : 0;
  }

  // A grown-up skipped it: keep what was measured, the rest stays the whole width.
  skip() {
    this.finished = true;
  }

  // 0..1 through the current side, for a progress hint (it fills as the kids stop finding new ground).
  get progress() {
    if (this.phase === 'done') return 1;
    return Math.min(1, this.calm / CAL.settle);
  }

  /** @returns {PlayArea} */
  get area() {
    return playArea(this.lo, this.hi, this.handLo, this.handHi, this.sides);
  }
}

/**
 * The play space from what was explored. An unmeasured side is the whole way to the screen's edge, a narrow range
 * is widened around its middle, and hands always reach at least as far as the body can go.
 * @param {number} lo @param {number} hi  explored body range
 * @param {number} handLo @param {number} handHi  explored hand range
 * @param {{ left: boolean, right: boolean }} sides
 * @returns {PlayArea}
 */
export function playArea(lo, hi, handLo, handHi, sides) {
  if (!(lo <= hi)) return { ...FULL_AREA };
  let x0 = sides.left ? lo : 0;
  let x1 = sides.right ? hi : 1;
  if (x1 - x0 < CAL.minWidth) {
    const mid = Math.min(1 - CAL.minWidth / 2, Math.max(CAL.minWidth / 2, (x0 + x1) / 2));
    x0 = mid - CAL.minWidth / 2;
    x1 = mid + CAL.minWidth / 2;
  }
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const reach0 = sides.left ? clamp01(Math.min(x0, handLo) - CAL.reachSlack) : 0;
  const reach1 = sides.right ? clamp01(Math.max(x1, handHi) + CAL.reachSlack) : 1;
  return { x0: clamp01(x0), x1: clamp01(x1), reach0, reach1 };
}

/** @param {URLSearchParams} params */
export const shouldCalibrate = (params) => !params.has('nocal') && !params.has('level');
