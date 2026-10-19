// Who is who. Pure logic (no camera, no DOM) that turns this frame's detections into the game's players:
//
//   - PROBATION: a new body has to be tracked for a moment (and look like a standing person) before it
//     becomes a player, so a dog trotting past or a one-frame ghost never pops into the game.
//   - MATCHING: each detection is matched to the closest known player by where their shoulders are, side to
//     side AND up and down, in shoulder widths, so a kid keeps their colour and score from frame to frame.
//     Height matters: a grown-up lying on the sofa under a standing kid is at the same place left-to-right,
//     and matching by that alone swapped the two whenever the model found only one of them in a frame.
//     Best pairs are taken first across everyone, so a near miss never steals a better match.
//   - COMING BACK: a player who is lost (hidden behind a parent, out of frame) is remembered for a while.
//     When a body appears near where they went, or anywhere with the same look (clothing colours), it is the
//     same player again: same colour, same score. A different look is a different person. Two dark outfits
//     in a dim room are not "the same look": the look must be distinctive compared with how dark it is.
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
  matchDist: 0.3, // max sideways distance (fraction of screen width) to match a detection to a visible player
  returnDist: 0.2, // ...to a lost player by position alone (they usually come back where they went)
  // Max up-and-down distance between a body's shoulders and a player's, in shoulder widths. A jump is ~0.5,
  // a crouch ~1; a grown-up on the sofa under a standing kid is 1.5-3 away. Between tracked frames a body
  // can only have moved so far: the allowance grows with the time since the player was last seen, from
  // `riseNow` to `matchRise` (which a lost player coming back gets in full).
  riseNow: 0.3,
  riseRate: 4, // extra shoulder widths per second unseen (a kid's jump takes off at up to ~8 a second; slow tracking sees big steps)
  matchRise: 1.2,
  lookMatch: 0.1, // max look distance for a lost player to be recognised anywhere on screen...
  lookRel: 0.35, // ...and it must also be under this fraction of the two looks' brightness added together
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
const CORE = [0, 11, 12, 23, 24]; // nose, shoulders, hips

/**
 * Is part of this body out of the picture? The model squeezes a body that is walking out of the side of the
 * picture, or standing so close that the hips are below the bottom, into a skeleton of the wrong size and
 * height, so those cannot be trusted for matching.
 * @param {Point[]} px
 * @param {number} W
 * @param {number} H
 */
export function isPartial(px, W, H) {
  return CORE.some((i) => px[i].x < 0 || px[i].x > W || px[i].y < 0 || px[i].y > H);
}
const cyOf = (/** @type {Point[]} */ px) => (px[11].y + px[12].y) / 2;
const swOf = (/** @type {Point[]} */ px) => Math.max(30, Math.hypot(px[11].x - px[12].x, px[11].y - px[12].y));
const brightness = (/** @type {number[]} */ look) => look.reduce((a, b) => a + b, 0) / look.length;

/**
 * Could this detection be this player (or candidate)? The shoulders must be within `maxDx` sideways and within
 * `rise` shoulder widths up or down. The unit is the geometric mean of the two shoulder widths, so a big body
 * close to the camera does not get a big allowance to match a small one. Returns a cost (lower is a better
 * match; the up-and-down part weighs most since kids move sideways far more than up and down) or Infinity.
 * @param {{ cx: number, cy: number, sw: number }} a  where the player's shoulders were
 * @param {Point[]} px  the detection's skeleton
 * @param {number} maxDx
 * @param {number} rise
 */
function matchCost(a, px, maxDx, rise) {
  const dx = Math.abs(a.cx - cxOf(px));
  const dy = Math.abs(a.cy - cyOf(px));
  const s = Math.sqrt(a.sw * swOf(px));
  if (dx > maxDx || dy > rise * s) return Infinity;
  return dx / maxDx + dy / s;
}

/**
 * The same look, seen again? Only a distinctive look counts: the distance must be small compared with how
 * bright the looks are, or every dark outfit would be every other dark outfit.
 * @param {number[] | null | undefined} a
 * @param {number[] | null | undefined} b
 * @param {typeof DEFAULTS} o
 */
function sameLook(a, b, o) {
  const ld = lookDistance(a, b);
  if (ld === Infinity) return false;
  return ld < o.lookMatch && ld < o.lookRel * (brightness(/** @type {number[]} */ (a)) + brightness(/** @type {number[]} */ (b)));
}

/**
 * Greedy best-first assignment: the lowest-cost pair across everyone goes first, then the next among what is
 * left, so a near miss never steals a better match (two kids crossing, a kid over a sofa).
 * @template A, B
 * @param {A[]} as
 * @param {B[]} bs
 * @param {(a: A, b: B) => number} cost  Infinity = impossible
 * @returns {{ pairs: [A, B][], restA: A[], restB: B[] }}
 */
export function assign(as, bs, cost) {
  const all = [];
  as.forEach((a, i) => bs.forEach((b, j) => {
    const c = cost(a, b);
    if (c < Infinity) all.push({ c, i, j });
  }));
  all.sort((p, q) => p.c - q.c);
  const usedA = new Set();
  const usedB = new Set();
  const pairs = /** @type {[A, B][]} */ ([]);
  for (const { i, j } of all) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    pairs.push([as[i], bs[j]]);
  }
  return { pairs, restA: as.filter((_, i) => !usedA.has(i)), restB: bs.filter((_, j) => !usedB.has(j)) };
}

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
    this.H = 720;
    this.frameDt = 1 / 30; // average time between tracked frames
    this.lastMatch = null;
  }

  get dropout() {
    return Math.max(this.o.dropout, this.o.slowFrames * this.frameDt);
  }

  get candidateGap() {
    return Math.max(this.o.candidateGap, this.o.slowFrames * this.frameDt);
  }

  /** @param {number} W  @param {number} [H] */
  setView(W, H = (W * 9) / 16) {
    this.W = W;
    this.H = H;
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
    const H = this.H;
    // Matching compares raw detections with the raw shoulders matched last time (`seenAt`), never with the
    // smoothed skeleton: that lags a fast move like a jump by several frames, which put the kid outside the
    // up-and-down allowance for most of every jump (and on ~10 fps tracking no jump counted at all).
    const where = (/** @type {Player} */ p) => p.seenAt ?? { cx: p.cx, cy: p.sh?.y ?? 0, sw: p.shoulderW || 30 };
    const partial = new Map(dets.map((d) => [d, isPartial(d.px, W, H)]));
    // A body at the edge of the picture has no trustworthy height or size: match it sideways only, as a player
    // whose last sighting was at the edge is matched.
    const riseFor = (/** @type {Player} */ p, /** @type {Detection} */ d, /** @type {number} */ rise) => (p.partial || partial.get(d) ? Infinity : rise);

    // 1. visible players, by where their shoulders were a moment ago (best pairs first). A body can only have
    //    moved so far since the player was last seen: it cannot have teleported from standing to the sofa.
    const free = this.players.filter((p) => now - p.seen < dropout);
    const step1 = assign(free, dets, (p, d) => {
      const rise = Math.min(o.matchRise, o.riseNow + o.riseRate * (now - p.seen));
      return matchCost(where(p), d.px, W * o.matchDist, riseFor(p, d, rise));
    });
    const pairs = step1.pairs;

    // 2. someone coming back: a lost player near where they vanished, or with the same look anywhere
    const lost = this.players.filter((p) => now - p.seen >= dropout);
    const step2 = assign(lost, step1.restB, (p, d) => {
      const ld = lookDistance(p.look, d.look);
      if (ld < Infinity && ld > o.lookDiff) return Infinity; // a different person standing where a kid used to be
      const near = matchCost(where(p), d.px, W * o.returnDist, riseFor(p, d, o.matchRise));
      if (near === Infinity && !sameLook(p.look, d.look, o)) return Infinity;
      return (near < Infinity ? near * o.returnDist : 1) + (ld < Infinity ? ld : 0.5);
    });
    pairs.push(...step2.pairs);

    // 3. anyone else is on probation until they have been around for a moment and look like a person
    const nextCandidates = [];
    for (const d of step2.restB) {
      // shapes that are not a standing person, or are half out of the picture, never even start probation
      if (!isUpright(d.px) || partial.get(d)) continue;
      let c = null;
      let bd = Infinity;
      for (const k of this.candidates) {
        const dd = matchCost({ cx: cxOf(k.px), cy: cyOf(k.px), sw: swOf(k.px) }, d.px, W * o.matchDist, o.matchRise);
        const ld = lookDistance(k.look, d.look);
        if (dd < bd && (ld === Infinity || ld <= o.lookDiff)) {
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
      // where the shoulders are, for next frame's matching (the tracker refines cx, sh and shoulderW from the
      // smoothed skeleton; seenAt keeps the raw sighting)
      p.seenAt = { cx: cxOf(d.px), cy: cyOf(d.px), sw: swOf(d.px) };
      p.cx = p.seenAt.cx;
      p.sh = { x: p.cx, y: p.seenAt.cy };
      p.shoulderW = p.seenAt.sw;
      p.partial = partial.get(d);
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
