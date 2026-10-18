// Who is who. Pure logic (no camera, no DOM) that turns this frame's detections into the game's players:
//
//   - PROBATION: a new body has to be tracked for a moment (and look like a standing person) before it
//     becomes a player, so a dog trotting past or a one-frame ghost never pops into the game.
//   - MATCHING: each detection is matched to the closest known player by position, so a kid keeps their
//     colour and score from frame to frame.
//   - COMING BACK: a player who is lost (hidden behind a parent, out of frame) is remembered for a while.
//     When a body appears near where they went, or anywhere with the same look (clothing colours), it is the
//     same player again: same colour, same score. A different look is a different person.
//
// Nothing here switches instantly: players stay present through 0.6 s dropouts and are remembered for
// `forget` seconds after that.
/** @import { Player, Point } from './types.js' */

export const COLORS = ['#ff4d6d', '#4dd0ff', '#ffd24d', '#7dff6b', '#c77dff', '#ff9a3d'];

export const DEFAULTS = {
  probation: 0.45, // seconds a new body must be tracked before it becomes a player...
  sightings: 3, // ...and in at least this many tracked frames
  candidateGap: 0.3, // a candidate not seen for this long starts probation again
  dropout: 0.6, // seconds a player stays "present" without being seen
  // On a slow device tracking may only manage a few frames a second; the gaps above then stretch to cover
  // this many tracked frames, so a slow machine never makes kids flicker or never lets them in.
  slowFrames: 2.5,
  forget: 20, // seconds a lost player is remembered, so they can come back with their score
  matchDist: 0.3, // max distance (fraction of screen width) to match a detection to a visible player
  returnDist: 0.2, // ...to a lost player by position alone (they usually come back where they went)
  lookMatch: 0.1, // max look distance for a lost player to be recognised anywhere on screen
  lookDiff: 0.2, // a look further than this from a candidate's is definitely someone else
};

/**
 * What the tracker hands in for each body the pose model found this frame.
 * @typedef {object} Detection
 * @property {Point[]} px        33 landmarks in screen space
 * @property {number[]} vis      per-landmark visibility 0..1
 * @property {number[] | null} look  appearance signature (see lookDistance), or null if unavailable
 */

/**
 * Does this skeleton look like a standing (or sitting) person rather than a pet or a mis-detection?
 * Head above the shoulders, hips below them, and a sensible shoulder width. Measured in shoulder widths
 * so it holds for toddlers and adults alike. Deliberately loose: a crouching kid must still pass.
 * @param {Point[]} px
 */
export function isUpright(px) {
  const shoulderW = Math.hypot(px[11].x - px[12].x, px[11].y - px[12].y);
  if (shoulderW < 20) return false;
  const shY = (px[11].y + px[12].y) / 2;
  const hipY = (px[23].y + px[24].y) / 2;
  const headAbove = px[0].y < shY + 0.2 * shoulderW;
  const hipsBelow = hipY > shY + 0.2 * shoulderW;
  return headAbove && hipsBelow;
}

/**
 * Distance between two looks (0 = identical). A look is a short list of numbers in 0..1 (mean colours of
 * the shirt and trousers); any length works as long as both sides agree.
 * @param {number[] | null | undefined} a
 * @param {number[] | null | undefined} b
 * @returns {number} 0..~1, or Infinity when either side is unknown
 */
export function lookDistance(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

const cxOf = (/** @type {Point[]} */ px) => (px[11].x + px[12].x) / 2;

export class People {
  /** @param {Partial<typeof DEFAULTS>} [opts] */
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    /** @type {Player[]} everyone known: visible players first, then lost ones (present = false) */
    this.players = [];
    /** @type {{ px: Point[], look: number[] | null, first: number, seen: number, n: number }[]} bodies on probation */
    this.candidates = [];
    this.nextId = 1;
    this.W = 1280;
    this.frameDt = 1 / 30; // average time between tracked frames
    this.lastMatch = null;
  }

  get dropout() {
    return Math.max(this.o.dropout, this.o.slowFrames * this.frameDt);
  }

  get candidateGap() {
    return Math.max(this.o.candidateGap, this.o.slowFrames * this.frameDt);
  }

  setView(/** @type {number} */ W) {
    this.W = W;
  }

  /** The players the game should see: visible, or lost less than `dropout` + a little ago. */
  get visible() {
    return this.players.filter((p) => p.present);
  }

  /** Forget everyone (a new camera, a new picture size). */
  reset() {
    this.players = [];
    this.candidates = [];
  }

  /**
   * Feed one frame of detections. Returns the players matched this frame as [player, detection] pairs; the
   * tracker then smooths each player's skeleton from its detection. Players not matched keep their last
   * skeleton. Call `tick(now)` afterwards to age everyone.
   * @param {Detection[]} dets
   * @param {number} now  game time in seconds
   * @returns {[Player, Detection][]}
   */
  match(dets, now) {
    const o = this.o;
    const W = this.W;
    if (this.lastMatch !== null) this.frameDt += (Math.min(1, Math.max(0, now - this.lastMatch)) - this.frameDt) * 0.2;
    this.lastMatch = now;
    const dropout = this.dropout;
    const pairs = /** @type {[Player, Detection][]} */ ([]);
    const free = new Set(this.players.filter((p) => now - p.seen < dropout));
    const lost = new Set(this.players.filter((p) => now - p.seen >= dropout));
    const unmatched = [];

    // 1. visible players, by position (closest first so two kids crossing don't swap on a tie)
    const sorted = [...dets].sort((a, b) => cxOf(a.px) - cxOf(b.px));
    for (const d of sorted) {
      const cx = cxOf(d.px);
      let best = null;
      let bd = Infinity;
      for (const p of free) {
        const dd = Math.abs(p.cx - cx);
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (best && bd < W * o.matchDist) {
        free.delete(best);
        pairs.push([best, d]);
      } else unmatched.push(d);
    }

    // 2. someone coming back: a lost player near where they vanished, or with the same look anywhere
    const still = [];
    for (const d of unmatched) {
      const cx = cxOf(d.px);
      let best = null;
      let score = Infinity;
      for (const p of lost) {
        const near = Math.abs(p.cx - cx) < W * o.returnDist;
        const ld = lookDistance(p.look, d.look);
        const sameLook = ld < o.lookMatch;
        const differentLook = ld < Infinity && ld > o.lookDiff;
        if (differentLook) continue; // a different person standing where a kid used to be
        if (!near && !sameLook) continue;
        const s = (near ? Math.abs(p.cx - cx) / W : 1) + (ld < Infinity ? ld : 0.5);
        if (s < score) {
          score = s;
          best = p;
        }
      }
      if (best) {
        lost.delete(best);
        pairs.push([best, d]);
      } else still.push(d);
    }

    // 3. anyone else is on probation until they have been around for a moment and look like a person
    const nextCandidates = [];
    for (const d of still) {
      if (!isUpright(d.px)) continue; // shapes that are not a standing person never even start probation
      const cx = cxOf(d.px);
      let c = null;
      let bd = Infinity;
      for (const k of this.candidates) {
        const dd = Math.abs(cxOf(k.px) - cx);
        const ld = lookDistance(k.look, d.look);
        if (dd < bd && dd < W * o.matchDist && (ld === Infinity || ld <= o.lookDiff)) {
          bd = dd;
          c = k;
        }
      }
      if (c && now - c.seen <= this.candidateGap) {
        c.px = d.px;
        c.look = d.look ?? c.look;
        c.seen = now;
        c.n++;
        this.candidates.splice(this.candidates.indexOf(c), 1);
      } else c = { px: d.px, look: d.look, first: now, seen: now, n: 1 };
      if (now - c.first >= o.probation && c.n >= o.sightings) {
        const p = this._newPlayer(now);
        p.look = c.look;
        pairs.push([p, d]);
      } else nextCandidates.push(c);
    }
    this.candidates = nextCandidates;

    for (const [p, d] of pairs) {
      p.seen = now;
      p.present = true;
      p.cx = cxOf(d.px); // the tracker refines this from the smoothed skeleton
      if (d.look) p.look = p.look ? p.look.map((v, i) => v + (d.look[i] - v) * 0.05) : d.look; // learn slowly
    }
    return pairs;
  }

  /**
   * Age everyone: presence through short dropouts, forgetting after `forget` seconds.
   * @param {number} now
   * @returns {Player[]} the players the game should see (visible ones)
   */
  tick(now) {
    const o = this.o;
    this.players = this.players.filter((p) => now - p.seen < o.forget);
    const dropout = this.dropout;
    for (const p of this.players) p.present = now - p.seen < dropout;
    return this.players.filter((p) => p.present);
  }

  /** @param {number} now */
  _newPlayer(now) {
    const used = new Set(this.players.filter((p) => now - p.seen < this.o.forget).map((q) => q.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    /** @type {Player} */
    const p = {
      id: this.nextId++,
      slot,
      color: COLORS[slot % COLORS.length],
      // @ts-ignore filled in by the tracker before anyone reads it
      px: null,
      present: true,
      isNew: true,
      seen: now,
      score: 0,
      jumps: 0,
      lastJump: -99,
      hitUntil: 0,
      pose: {},
      hands: [],
      circles: [],
      sh: { x: 0, y: 0 },
      hip: { x: 0, y: 0 },
      cx: 0,
      shoulderW: 0,
      torso: 0,
    };
    this.players.push(p);
    return p;
  }
}
