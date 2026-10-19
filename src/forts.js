// Fort games (docs/FORT-GAMES.md): every player gets their own fort, a column of the screen, and their cut-out is
// moved into it. Kids standing an arm's reach apart in the room end up far apart in the game world, so they can
// throw things at each other across the screen. Family guests get forts too, like everyone else.
//
// Pure maths plus two small canvas helpers (no DOM): main.js keeps one FortLayout, updates it every frame of a
// level with `forts: true` and draws each player's cut-out through applyFort(). Levels read the forts with
// forts(g) from kit.js and use each fort's `hands`, `circles` and `head`, which are already in fort space.
/** @import { Player, Point, Circle } from './types.js' */

export const FORT = {
  gap: 0.05, // fraction of the width between forts (and at the screen edges): the no-man's-land snowballs fly over
  minForts: 2, // one kid alone still gets a second fort, for the level to fill (Snowball fight puts a snowman there)
  follow: 3, // per second: how fast a fort re-centres on its kid. Kids barely move in fort games, so this is firm
  sway: 0.25, // a kid can lean this far (fraction of the fort width) off the middle before the fort follows
  span: 4.6, // shoulder widths a kid takes with arms out: the fort shrinks a kid who would not fit
  minScale: 0.55,
  slide: 4, // per second: how fast forts slide to a new layout when someone joins or leaves (nothing pops)
  keep: 3, // s an empty fort is kept for a kid who dropped out of tracking, so the others don't shuffle
  ground: 1, // fraction of the height that stays put when a kid is scaled: the floor
};

/**
 * One player's fort. Drawing: applyFort(ctx, f, H) maps the camera picture into it. Gameplay: `hands`, `circles`,
 * `head` and `sh` are the player's body already mapped into the fort; `map(pt)` maps any other landmark.
 * @typedef {object} Fort
 * @property {number} i          slot, left to right
 * @property {number} id         the player's id (kept while an empty fort waits for them), or -1 for a spare fort
 * @property {Player | null} p   the player, or null while their fort is empty (dropped out, or a spare fort)
 * @property {number} x0         the fort's left edge on screen, px
 * @property {number} x1         right edge
 * @property {number} cx         middle
 * @property {number} s          scale of the kid in the fort (1 = as the camera sees them)
 * @property {number} home       the camera x (screen px) that is drawn at the fort's middle
 * @property {number} src0       the slice of the camera picture (screen px, left edge) that belongs to this kid
 * @property {number} src1
 * @property {number} tilt       radians: the picture wobbles or spins (wobbleFort / spinFort)
 * @property {number} lift       px: the kid's picture is raised this far in their fort (liftFort: flying)
 * @property {Point} pivot       what it tilts around (the middle of the body, in fort space)
 * @property {(pt: Point) => Point} map
 * @property {Point[]} hands
 * @property {Circle[]} circles
 * @property {Point} head
 * @property {Point} sh
 */

const FAR = 1e6;

export class FortLayout {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {{ id: number, home: number, s: number, x0: number, x1: number, gone: number, tilt: number, vel: number, spin: number, lift: number }[]} */
    this.slots = [];
    /** @type {Fort[]} */
    this.forts = [];
    this.fresh = true; // the first update places forts at once instead of sliding them in
  }

  /**
   * @param {Player[]} players  the players in the game (g.activePlayers())
   * @param {number} W @param {number} H @param {number} dt
   * @returns {Fort[]}
   */
  update(players, W, H, dt) {
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const s of this.slots) s.gone = byId.has(s.id) ? 0 : s.gone + dt;
    this.slots = this.slots.filter((s) => s.gone < FORT.keep);
    // At the start, forts go left to right in the order the kids stand. Someone joining later gets the next fort
    // along (taking over the spare fort of a lone kid, where the level's computer player was), so nobody else's
    // fort moves.
    const known = new Set(this.slots.map((s) => s.id));
    for (const p of [...players].filter((q) => !known.has(q.id)).sort((a, b) => a.cx - b.cx)) {
      this.slots.push( { id: p.id, home: p.cx, s: 1, x0: W / 2, x1: W / 2, gone: 0, tilt: 0, vel: 0, spin: 0, lift: 0 });
    }

    const n = Math.max(FORT.minForts, this.slots.length);
    const gap = FORT.gap * W;
    const w = (W - gap * (n + 1)) / n;
    const k = this.fresh ? 1 : Math.min(1, dt * FORT.slide);
    const follow = this.fresh ? 1 : Math.min(1, dt * FORT.follow);
    this.fresh = false;
    /** @type {Fort[]} */
    const out = [];
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i];
      const x0 = gap + i * (w + gap);
      if (!slot) {
        out.push(spareFort(i, x0, x0 + w, H));
        continue;
      }
      slot.x0 += (x0 - slot.x0) * k;
      slot.x1 += (x0 + w - slot.x1) * k;
      const p = byId.get(slot.id) ?? null;
      if (p) {
        const fit = Math.min(1, Math.max(FORT.minScale, w / (FORT.span * Math.max(1, p.shoulderW))));
        slot.s += (fit - slot.s) * follow;
        // the fort follows its kid, but a kid leaning a little still leans in the picture
        const lean = (FORT.sway * w) / slot.s;
        slot.home += (p.cx - slot.home) * follow;
        slot.home = Math.min(p.cx + lean, Math.max(p.cx - lean, slot.home));
      }
      // wobble: a springy tilt that settles; spin: one whole turn that runs down
      slot.vel += (-60 * slot.tilt - 7 * slot.vel) * dt;
      slot.tilt += slot.vel * dt;
      slot.spin = Math.max(0, slot.spin - dt * 1.4);
      out.push(playerFort(i, slot, p, H));
    }
    // Each kid's slice of the camera picture: halfway to the next kid from the same home (guests come in on
    // their own picture, so a guest never cuts a slice out of a local kid).
    for (const f of out) {
      if (!f.p) continue;
      for (const o of out) {
        if (o === f || !o.p || !!o.p.remote !== !!f.p.remote) continue;
        const mid = (f.p.cx + o.p.cx) / 2;
        if (o.p.cx < f.p.cx) f.src0 = Math.max(f.src0, mid);
        else f.src1 = Math.min(f.src1, mid);
      }
    }
    this.forts = out;
    return out;
  }

  /** The fort's picture shakes like a jelly. @param {number} id @param {number} [amount] radians/s kick */
  wobble(id, amount = 4) {
    const s = this.slots.find((q) => q.id === id);
    if (s) s.vel += amount * (Math.random() < 0.5 ? -1 : 1);
  }

  /** Raise the kid's picture in their fort (px, 0 = standing on the floor). @param {number} id @param {number} px */
  lift(id, px) {
    const s = this.slots.find((q) => q.id === id);
    if (s) s.lift = px;
  }

  /** The fort's picture spins round once. @param {number} id */
  spin(id) {
    const s = this.slots.find((q) => q.id === id);
    if (s && s.spin <= 0) s.spin = 1;
  }
}

/** @param {number} i @param {number} x0 @param {number} x1 @param {number} H @returns {Fort} */
function spareFort(i, x0, x1, H) {
  const cx = (x0 + x1) / 2;
  const id = (/** @type {Point} */ pt) => ({ x: pt.x, y: pt.y });
  const head = { x: cx, y: H * 0.42 };
  return { i, id: -1, p: null, x0, x1, cx, s: 1, home: cx, src0: -FAR, src1: FAR, tilt: 0, lift: 0, pivot: { x: cx, y: H * 0.6 }, map: id, hands: [], circles: [], head, sh: { x: cx, y: H * 0.5 } };
}

/** @returns {Fort} */
function playerFort(/** @type {number} */ i, /** @type {any} */ slot, /** @type {Player | null} */ p, /** @type {number} */ H) {
  const cx = (slot.x0 + slot.x1) / 2;
  const s = slot.s;
  const gy = H * FORT.ground;
  const lift = slot.lift;
  const map = (/** @type {Point} */ pt) => ({ x: cx + (pt.x - slot.home) * s, y: gy + (pt.y - gy) * s - lift });
  const spinA = slot.spin > 0 ? (1 - slot.spin) ** 0.6 * Math.PI * 2 : 0; // fast at first, slowing to a stop
  const tilt = slot.tilt + spinA;
  if (!p) {
    const f = spareFort(i, slot.x0, slot.x1, H);
    return { ...f, id: slot.id, tilt };
  }
  const sh = map(p.sh);
  const hip = map(p.hip);
  return {
    i, id: p.id, p, x0: slot.x0, x1: slot.x1, cx, s, home: slot.home, src0: -FAR, src1: FAR, tilt, lift,
    pivot: { x: (sh.x + hip.x) / 2, y: (sh.y + hip.y) / 2 },
    map,
    hands: p.hands.map(map),
    circles: p.circles.map((c) => ({ ...map(c), r: c.r * s })),
    head: map(p.px?.[0] ?? p.sh),
    sh,
  };
}

/** The fort a player is in, or null. @param {Fort[]} forts @param {Player} p */
export const fortOf = (forts, p) => forts.find((f) => f.p === p) ?? null;

/**
 * Set up `ctx` so that drawing in camera screen space lands in the fort: clipped to the fort and (unless
 * `slice` is false) to this kid's slice of the picture, scaled, and tilted. Wrap it in ctx.save() / ctx.restore().
 * Levels use it with `slice: false` to draw things stuck on a kid (a hat, a splat) that wobble along with them.
 * @param {CanvasRenderingContext2D} ctx @param {Fort} f @param {number} H @param {{ slice?: boolean }} [o]
 */
export function applyFort(ctx, f, H, { slice = true } = {}) {
  ctx.beginPath();
  ctx.rect(f.x0, -H, f.x1 - f.x0, H * 3);
  ctx.clip();
  if (f.lift) ctx.translate(0, -f.lift);
  if (f.tilt) {
    ctx.translate(f.pivot.x, f.pivot.y + f.lift); // the pivot is in fort space, which already includes the lift
    ctx.rotate(f.tilt);
    ctx.translate(-f.pivot.x, -f.pivot.y - f.lift);
  }
  const gy = H * FORT.ground;
  ctx.translate(f.cx, gy);
  ctx.scale(f.s, f.s);
  ctx.translate(-f.home, -gy);
  if (slice && (f.src0 > -FAR || f.src1 < FAR)) {
    const a = Math.max(f.src0, f.home - FAR / 2);
    const b = Math.min(f.src1, f.home + FAR / 2);
    ctx.beginPath();
    ctx.rect(a, -H * 4, b - a, H * 9);
    ctx.clip();
  }
}

/**
 * The forts for this frame, kept on the game object (`g.forts`, `g.fortLayout`). main.js calls it every frame of a
 * fort level; a level (or a test with a pretend `g`) can call it too: it updates at most once per `g.now`.
 * @param {import('./types.js').Game} g
 * @returns {Fort[]}
 */
export function syncForts(g) {
  if (!g.fortLayout) g.fortLayout = new FortLayout();
  if (g.fortsAt !== g.now || !g.forts) {
    const dt = Math.min(0.1, Math.max(0, g.now - (g.fortsAt ?? g.now)));
    g.fortsAt = g.now;
    g.forts = g.fortLayout.update(g.activePlayers(), g.W, g.H, dt);
  }
  return g.forts;
}
