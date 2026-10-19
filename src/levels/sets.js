// Game sets: the first cards in the picker. A set plays a few levels in a row, each straight after the last, and
// then it's back to the picker. The last card, "Pick your game", opens the picker with every level in it.
//
// Every level belongs in at least one set besides Party mix (test/unit/sets.test.js checks), so a new level isn't
// only ever found by scrolling.
/** @import { Level } from '../types.js' */

/**
 * @typedef {object} GameSet
 * @property {string} id
 * @property {string} title  short: it's read out by a grown-up, and drawn big on the card
 * @property {string} icon  an emoji, the card's big picture
 * @property {string} color  the card's border
 * @property {string[] | null} levels  level ids, played in this order; null = a random mix of `count` levels
 * @property {number} [count]
 */

/** @typedef {{ set: GameSet, order: number[], at: number }} Playlist  a set being played: its levels, and which one is on */

/** @type {GameSet[]} */
export const SETS = [
  { id: 'party', title: 'Party mix', icon: '🎉', color: '#ff6bd6', levels: null, count: 4 },
  // the kids' favourites: whole-body dodging and jumping, the avalanche as the big finish
  { id: 'active', title: 'Jump & dodge', icon: '🏃', color: '#ff8a3d', levels: ['jump', 'dodge', 'duckjump', 'dig', 'avalanche'] },
  // mostly hands, gentler: good for little ones or a calmer moment
  { id: 'catch', title: 'Catch & pop', icon: '🙌', color: '#4dd2ff', levels: ['bubbles', 'balloons', 'meteor'] },
  { id: 'dance', title: 'Dance & pose', icon: '🕺', color: '#b07bff', levels: ['freeze', 'wall', 'dance'] },
];

// The levels a set plays, as indices into `levels`. A mix picks `count` different levels at random and doesn't
// start with the level just played; a level id that isn't in the list is left out.
/** @param {GameSet} set @param {Level[]} levels @param {number} [last] @param {() => number} [rand] @returns {number[]} */
export function setPlaylist(set, levels, last = -1, rand = Math.random) {
  if (set.levels) return set.levels.map((id) => levels.findIndex((L) => L.id === id)).filter((i) => i >= 0);
  const pool = levels.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = pool.slice(0, Math.min(set.count ?? 4, pool.length));
  if (out.length > 1 && out[0] === last) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

// The levels pictured on a set's card: its own, or for a mix a spread across the whole list.
/** @param {GameSet} set @param {Level[]} levels @returns {Level[]} */
export function setPictures(set, levels) {
  if (set.levels) return setPlaylist(set, levels).map((i) => levels[i]);
  const n = Math.min(set.count ?? 4, levels.length);
  return Array.from({ length: n }, (_, k) => levels[Math.floor((k * levels.length) / n)]);
}
