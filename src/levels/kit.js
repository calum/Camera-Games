// Small helpers shared by the levels, so each level file stays about its own idea. See docs/ADDING-GAMES.md.
/** @import { Player, Level, Game } from '../types.js' */
import { sfx } from '../audio.js';
import { FULL_AREA } from '../calibrate.js';
import { syncForts } from '../forts.js';

export const rand = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.random() * (b - a);
/** @template T @param {T[]} arr @returns {T} */
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

// The play space (calibrate.js): the part of the picture the kids showed they can really get to, before the
// picker. A wall or a sofa can be in the picture, and a level must never put something to touch, catch or stand
// in over it. Without a calibration (?level=, tests) it is the whole screen, so these are then plain `f * g.W`.
//   reachX(g, f): f = 0..1 across where hands can get to: bubbles, stars, balloons, rocks.
//   standX(g, f): f = 0..1 across where a body can stand: a safe gap, a treasure column.
/** @param {Game} g @param {number} f */
export const reachX = (g, f) => {
  const a = g.area ?? FULL_AREA;
  return (a.reach0 + f * (a.reach1 - a.reach0)) * g.W;
};
/** @param {Game} g @param {number} f */
export const standX = (g, f) => {
  const a = g.area ?? FULL_AREA;
  return (a.x0 + f * (a.x1 - a.x0)) * g.W;
};

// Fort games (docs/FORT-GAMES.md): a level with `forts: true` draws every player in their own fort.
//   forts(g): this frame's forts, left to right. Use f.hands / f.circles / f.head (already in fort space), and
//             f.p for the player (null for an empty fort: a kid who dropped out, or the spare fort of a lone kid).
//   wobbleFort(g, p) / spinFort(g, p): the kid's picture wobbles like a jelly, or spins round once. Funny on a hit.
//   liftFort(g, p, px): raise the kid's picture in their fort (flying), 0 = back on the floor.
/** @param {Game} g */
export const forts = (g) => syncForts(g);
/** @param {Game} g @param {Player} p @param {number} [amount] */
export const wobbleFort = (g, p, amount) => g.fortLayout?.wobble(p.id, amount);
/** @param {Game} g @param {Player} p */
export const spinFort = (g, p) => g.fortLayout?.spin(p.id);
/** @param {Game} g @param {Player} p @param {number} px */
export const liftFort = (g, p, px) => g.fortLayout?.lift(p.id, px);

/**
 * Arm pumps, the fort games' "throw": a hand that was down by the body (wrist below the shoulders) goes up above
 * the head. It needs no speed, only where the wrist is, so it works at a slow 10 tracked frames a second, and a
 * kid can do it standing still. Measured in shoulder widths, with a gap between "down" and "up" (hysteresis).
 */
export class ArmPumps {
  constructor() {
    /** @type {Map<number, { 15: string, 16: string, down15: number, down16: number }>} */
    this.state = new Map();
  }

  /**
   * The wrists (15 = the kid's left, 16 = right) that just went up, each with how long it was down first (s: a
   * longer wind-up can make a bigger snowball). Call once per frame for each player.
   * @param {Player} p @param {number} dt
   * @returns {{ wrist: 15 | 16, wound: number }[]}
   */
  update(p, dt) {
    let st = this.state.get(p.id);
    if (!st) this.state.set(p.id, (st = { 15: 'up', 16: 'up', down15: 0, down16: 0 })); // lower an arm first
    const sw = Math.max(1, p.shoulderW);
    const top = Math.min(p.px[0].y, p.sh.y - 0.6 * sw); // above the head (or well above the shoulders)
    /** @type {{ wrist: 15 | 16, wound: number }[]} */
    const out = [];
    for (const w of /** @type {(15 | 16)[]} */ ([15, 16])) {
      const y = p.px[w].y;
      const key = /** @type {'down15' | 'down16'} */ (`down${w}`);
      if (st[w] === 'up' && y > p.sh.y + 0.35 * sw) {
        st[w] = 'down';
        st[key] = 0;
      } else if (st[w] === 'down') {
        st[key] += dt;
        if (y < top) {
          st[w] = 'up';
          out.push({ wrist: w, wound: st[key] });
        }
      }
    }
    return out;
  }

  /** Is this wrist down, winding up? @param {Player} p @param {15 | 16} wrist */
  isDown(p, wrist) {
    return this.state.get(p.id)?.[wrist] === 'down';
  }

  /** @param {Player} p @param {15 | 16} wrist */
  wound(p, wrist) {
    const st = this.state.get(p.id);
    return st ? st[wrist === 15 ? 'down15' : 'down16'] : 0;
  }
}

/**
 * The first player whose hand is within `r + slack` of (x, y), or null. Hands are wrists and index fingertips.
 * The slack is deliberately generous: kids are small and tracking is noisy (CLAUDE.md, pitfall 8).
 * @param {Player[]} players  pass g.activePlayers()
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {number} [slack]    extra reach in px (usually 30 * g.u)
 * @returns {Player | null}
 */
export function handTouching(players, x, y, r, slack = 0) {
  for (const p of players) if (p.hands.some((h) => Math.hypot(h.x - x, h.y - y) < r + slack)) return p;
  return null;
}

/**
 * The first player whose body (head, chest, belly, hips, knees) overlaps a circle at (x, y) of radius r, or null.
 * Body circles count at 80% of their size, so a near miss is a miss.
 * @param {Player[]} players  pass g.activePlayers()
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @returns {Player | null}
 */
export function bodyHit(players, x, y, r) {
  for (const p of players) if (p.circles.some((c) => Math.hypot(c.x - x, c.y - y) < r + c.r * 0.8)) return p;
  return null;
}

/**
 * Something hit a kid: the team loses a heart (with a bonk and a burst at x, y), the auto-ease hears about it,
 * and the level ends when the hearts run out. `p` (the kid who was hit) flashes for a moment.
 * @param {Game} g
 * @param {Player | null} p
 * @param {number} x
 * @param {number} y
 */
export function loseHeart(g, p, x, y) {
  if (p) p.hitUntil = g.now + 0.8;
  g.team.hearts--;
  g.burst(x, y, '#ff5a3a', 24);
  sfx.bonk();
  g.miss();
  if (g.team.hearts <= 0) g.endLevel('Oh no, out of hearts! Try again!');
}

/**
 * The problems with a level definition (empty when it is fine). The unit tests run this on every level in
 * the list, so a new level gets checked automatically.
 * @param {Level} level
 * @returns {string[]}
 */
export function checkLevel(level) {
  const problems = [];
  const name = level?.id ?? '(no id)';
  if (!level || typeof level !== 'object') return ['a level must be an object'];
  if (typeof level.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(level.id)) problems.push(`${name}: id must be short lowercase text like "stars"`);
  for (const key of ['title', 'hint', 'color']) if (typeof level[key] !== 'string' || !level[key]) problems.push(`${name}: needs a ${key}`);
  if (!(level.duration > 0)) problems.push(`${name}: duration must be a number of seconds`);
  for (const fn of ['start', 'update', 'draw']) if (typeof level[fn] !== 'function') problems.push(`${name}: needs a ${fn}() function`);
  if (level.backdrop !== undefined && typeof level.backdrop !== 'string' && typeof level.backdrop?.dynamic !== 'function')
    problems.push(`${name}: backdrop must be a scene id or { static(), dynamic() }`);
  return problems;
}
