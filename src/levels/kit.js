// Small helpers shared by the levels, so each level file stays about its own idea. See docs/ADDING-GAMES.md.
/** @import { Player, Level, Game } from '../types.js' */
import { sfx } from '../audio.js';

export const rand = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.random() * (b - a);
/** @template T @param {T[]} arr @returns {T} */
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

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
