// The level picker: a carousel of big picture cards, chosen with the body, no reading needed.
//
// The current game is a big card at the top in the middle, the previous and next ones smaller on either side. A kid
// waves a hand out to the side to scroll: a hand out to the right shows the next game, to the left the previous
// one (the picture is mirrored, so a kid's right hand is on the right of the screen). Holding a hand out keeps
// scrolling, slowly. To play the game in the middle, any playing kid puts both arms straight up and holds them
// there for about a second while a ring fills (it drains slowly if the arms drop, so tracking jitter never
// resets it). Arms out like an airplane is the join gesture, so it doesn't play anything: with both hands out
// it is also a wave both ways at once, which cancels out. A grown-up can tap the side cards and the middle one,
// or use the arrow keys and Enter; the number keys still play a level directly.
//
// The picker opens on the game sets (src/levels/sets.js): Party mix and a few themed sets, each playing a few
// levels in a row, and last "Pick your game", which swaps the cards for one per level. After the levels come
// "Surprise!", a random level, and "Back" to the sets, so kids never need a grown-up to get out again.
//
// The maths (which way a kid is waving, the confirm ring, the layout) is pure and unit-tested; the drawing is at
// the bottom.
/** @import { Level, Player } from './types.js' */
/** @import { GameSet } from './levels/sets.js' */
import { Backdrops } from './backdrops.js';
import { setPictures } from './levels/sets.js';
import { artVersion } from './art.js';
import { text, drawPoseIcon, roundRectPath } from './draw.js';

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/**
 * @typedef {{ kind: 'level', index: number, level: Level } | { kind: 'surprise' } | { kind: 'back' }
 *   | { kind: 'set', index: number, set: GameSet } | { kind: 'all' }} Choice
 */

// The level cards: every level, then Surprise and Back (to the sets).
/** @param {Level[]} levels @returns {Choice[]} */
export function pickerChoices(levels) {
  return [...levels.map((level, index) => /** @type {Choice} */ ({ kind: 'level', index, level })), { kind: 'surprise' }, { kind: 'back' }];
}

// The set cards the picker opens on: every set, then "Pick your game".
/** @param {GameSet[]} sets @returns {Choice[]} */
export function setChoices(sets) {
  return [...sets.map((set, index) => /** @type {Choice} */ ({ kind: 'set', index, set })), { kind: 'all' }];
}

// Waving, in shoulder widths (s) from the middle of the shoulders, like every pose rule. A hand is "out" when it
// is more than OUT_IN to the side and between a little above the head and a little below the shoulders. It
// stays out until it comes back inside OUT_LEAVE (or drops or rises well out of the band), so waving a hand
// about out there counts as one wave, not many.
const OUT_IN = 1.0;
const OUT_LEAVE = 0.65;
const BAND_UP = 0.6; // above the nose
const BAND_DOWN = 0.6; // below the shoulders
const BAND_SLACK = 0.3; // extra room before a hand that is out counts as back in
const SETTLE = 0.15; // s a hand must be out (with the other one not) before it scrolls: rules out airplane arms rising
const REPEAT_AFTER = 1.0; // s of holding a hand out before it scrolls again...
const REPEAT_EVERY = 0.7; // ...and then every this long

// Which side a kid's hands are out to, given whether each side was already out (hysteresis).
//   p: a player (px, sh, shoulderW, hands); was: { left, right }. Returns { left, right }.
/** @param {Player} p @param {{ left: boolean, right: boolean }} was */
export function handsOut(p, was) {
  const s = p.shoulderW || 0;
  if (!s || !p.sh || !p.px?.[0]) return { left: false, right: false };
  const nose = p.px[0];
  const side = (dir, wasOut) => {
    const reach = wasOut ? OUT_LEAVE : OUT_IN;
    const slack = wasOut ? BAND_SLACK : 0;
    return (p.hands ?? []).some(
      (h) => h && (h.x - p.sh.x) * dir > reach * s && h.y > nose.y - (BAND_UP + slack) * s && h.y < p.sh.y + (BAND_DOWN + slack) * s,
    );
  };
  return { left: side(-1, was.left), right: side(1, was.right) };
}

export class Carousel {
  /** @param {{ n: number, hold?: number, wait?: number }} o */
  constructor({ n, hold = 1.0, wait = 0.8 }) {
    this.n = n; // number of cards; the list wraps round
    this.hold = hold; // seconds of arms up to play the card in the middle
    this.wait = wait; // nothing is chosen for this long after the picker opens
    this.reset(0);
  }

  // start: the card to show in the middle (the last level played, so "again!" is just arms up)
  reset(start = 0) {
    this.index = ((start % this.n) + this.n) % this.n;
    this.pos = this.index; // where the cards are drawn: slides towards index, so nothing jumps
    this.fill = 0; // the arms-up ring, 0..1
    this.t = 0;
    /** @type {Map<number, { left: boolean, right: boolean, outT: number, side: number, steps: number, ready: boolean }>} */
    this.kids = new Map();
  }

  // Move by one card (or more); a grown-up's arrow key, a tap, or a kid's wave. Restarts the ring, so a kid
  // can't play a game that only just slid into the middle.
  step(d) {
    this.index = (((this.index + d) % this.n) + this.n) % this.n;
    // keep pos close to index across the wrap, so it slides the short way
    while (this.pos - this.index > this.n / 2) this.pos -= this.n;
    while (this.index - this.pos > this.n / 2) this.pos += this.n;
    this.fill = 0;
  }

  // players: the kids who can choose. Returns { step: cards scrolled (usually -1, 0 or 1), chosen: card index or -1 }.
  /** @param {Player[]} players @param {number} dt */
  update(players, dt) {
    this.t += dt;
    let step = 0;
    let up = false;
    for (const p of players) {
      let k = this.kids.get(p.id);
      if (!k) this.kids.set(p.id, (k = { left: false, right: false, outT: 0, side: 0, steps: 0, ready: false }));
      const out = handsOut(p, k);
      k.left = out.left;
      k.right = out.right;
      // exactly one side out: that's a wave (both out is airplane arms, not a wave)
      const side = out.right && !out.left ? 1 : out.left && !out.right ? -1 : 0;
      if (side !== k.side) {
        k.side = side;
        k.outT = 0;
        k.steps = 0;
      } else if (side) {
        k.outT += dt;
        const due = k.outT < REPEAT_AFTER ? (k.outT >= SETTLE ? 1 : 0) : 2 + Math.floor((k.outT - REPEAT_AFTER) / REPEAT_EVERY);
        if (due > k.steps) {
          k.steps = due;
          step += side; // two kids waving opposite ways at once cancel out
        }
      }
      // Arms up only counts once this kid has been seen with their arms down here: kids often finish a level
      // cheering with their arms in the air, which mustn't start the next game by itself.
      if (!p.pose?.armsUp) k.ready = true;
      else if (k.ready && !side) up = true;
    }
    if (step) this.step(step);
    if (up && this.t >= this.wait) this.fill += dt / this.hold;
    else this.fill = Math.max(0, this.fill - dt / (this.hold * 2));
    this.pos += (this.index - this.pos) * Math.min(1, dt * 10);
    if (this.fill >= 1) {
      this.fill = 0;
      return { step, chosen: this.index };
    }
    return { step, chosen: -1 };
  }

  get progress() {
    return Math.min(1, this.fill);
  }
}

// Where the cards are drawn: the one in the middle big, near ones smaller and to the sides. `pos` is the
// carousel's (sliding) position. Returns, for each visible card, its index in the list, its rect and how far
// it is from the middle (0 = the middle card).
// The middle card's full size: about a third of the screen height (narrower on a portrait screen), and the
// cards sit in the top band from CARDS_TOP down, so the kids can watch themselves under the picker.
export const CARDS_TOP = 0.09;
export function cardSize(W, H) {
  const h = Math.min(H * 0.36, W * 0.3);
  return { w: h / 1.1, h };
}

/** @returns {{ i: number, rect: Rect, off: number }[]} */
export function carouselLayout(n, pos, W, H) {
  const { w, h } = cardSize(W, H);
  const cx = W / 2;
  const cy = H * CARDS_TOP + h / 2;
  const spacing = Math.min(W * 0.33, w * 1.25);
  const out = [];
  const base = Math.round(pos);
  const reach = n >= 5 ? 2 : Math.floor((n - 1) / 2); // a short list never shows a card twice
  for (let k = -reach; k <= reach; k++) {
    const off = base + k - pos;
    const a = Math.abs(off);
    const scale = a < 1 ? 1 - 0.4 * a : Math.max(0.35, 0.6 - 0.25 * (a - 1));
    const x = cx + Math.sign(off) * (a < 1 ? a : 1 + (a - 1) * 0.55) * spacing;
    const cw = w * scale;
    const ch = h * scale;
    const y = cy - ch / 2 + (1 - scale) * h * 0.15;
    out.push({ i: (((base + k) % n) + n) % n, rect: { x: x - cw / 2, y, w: cw, h: ch }, off });
  }
  return out.sort((a, b) => Math.abs(b.off) - Math.abs(a.off)); // far ones first, so the middle card is drawn on top
}

// Which card a point is over (the nearest to the middle wins where they overlap), or null.
/** @param {{ i: number, rect: Rect, off: number }[]} cards @param {{ x: number, y: number }} pt */
export function carouselCardAt(cards, pt) {
  let best = null;
  for (const c of cards) {
    const r = c.rect;
    if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h && (!best || Math.abs(c.off) < Math.abs(best.off))) best = c;
  }
  return best;
}

// A random level, never the one just played (when there is a choice).
export function surprisePick(n, last = -1, rand = Math.random) {
  if (n <= 1) return 0;
  let i = Math.floor(rand() * (n - 1));
  if (last >= 0 && last < n && i >= last) i++;
  return Math.min(n - 1, i);
}

// ------------------------------------------------------------------ drawing (browser only)

// A small picture of each level's cartoon world, drawn once per card size, and again when a family's own
// background art (assets/bg_<level>.png) finishes loading. A set's card shows its levels' pictures side by
// side, and "Pick your game" all of them; those are put together once too.
const thumbs = { key: '', canvases: /** @type {Map<string, HTMLCanvasElement>} */ (new Map()) };
function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
/** @param {Choice} c @param {Level[]} levels @param {number} w @param {number} h @returns {HTMLCanvasElement | undefined} */
function picture(c, levels, w, h) {
  const key = `${levels.length}:${Math.round(w)}x${Math.round(h)}:${artVersion()}`;
  if (thumbs.key !== key) {
    thumbs.key = key;
    thumbs.canvases = new Map();
  }
  const id = c.kind === 'level' ? c.level.id : c.kind === 'set' ? `set:${c.set.id}` : c.kind === 'all' ? 'all' : '';
  if (!id) return undefined;
  let pic = thumbs.canvases.get(id);
  if (pic) return pic;
  if (c.kind === 'level') {
    const L = c.level;
    pic = newCanvas(w, h);
    const custom = typeof L.backdrop === 'object' ? L.backdrop : undefined;
    try {
      new Backdrops().draw(pic.getContext('2d'), typeof L.backdrop === 'string' ? L.backdrop : L.id, pic.width, pic.height, 0, custom);
    } catch (e) {
      console.warn('no thumbnail for', L.id, e);
    }
  } else {
    // tiles in a grid as near square as the picture allows: 3 side by side, 4 as 2x2, 11 as 4x3
    const list = c.kind === 'set' ? setPictures(c.set, levels) : levels;
    const cols = Math.ceil(Math.sqrt(list.length * (w / h) * 0.6));
    const rows = Math.ceil(list.length / cols);
    pic = newCanvas(w, h);
    const ctx = pic.getContext('2d');
    list.forEach((L, k) => {
      const tile = picture({ kind: 'level', index: levels.indexOf(L), level: L }, levels, w, h);
      const x = Math.round(((k % cols) * pic.width) / cols);
      const y = Math.round((Math.floor(k / cols) * pic.height) / rows);
      if (tile) ctx.drawImage(tile, x, y, Math.ceil(pic.width / cols), Math.ceil(pic.height / rows));
    });
  }
  thumbs.canvases.set(id, pic);
  return pic;
}

// How a card looks: background, border, big picture, label.
/** @param {Choice} c */
function cardLook(c) {
  if (c.kind === 'level') return { bg: '#1b2340', border: c.level.color, icon: c.level.icon ?? '🎮', label: c.level.title };
  if (c.kind === 'set') return { bg: '#1b2340', border: c.set.color, icon: c.set.icon, label: c.set.title };
  if (c.kind === 'all') return { bg: '#1f3a2c', border: '#7dff6b', icon: '🎮', label: 'Pick your game' };
  if (c.kind === 'back') return { bg: '#2c2c3a', border: '#c9c9d9', icon: '⬅️', label: 'Back' };
  return { bg: '#3a1f5c', border: '#c79bff', icon: '🎲', label: 'Surprise!' };
}

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ W: number, H: number, u: number, now: number }} g
 * @param {Level[]} levels  every level (for the pictures)
 * @param {Choice[]} choices @param {Carousel} carousel
 * @param {{ i: number, rect: Rect, off: number }[]} cards  from carouselLayout
 * @param {number} lastStep  game time of the last scroll (the middle card bounces)
 */
export function drawPicker(ctx, g, levels, choices, carousel, cards, lastStep) {
  const u = g.u;
  const full = cardSize(g.W, g.H);
  for (const { i, rect: r, off } of cards) {
    const c = choices[i];
    const look = cardLook(c);
    const pic = picture(c, levels, full.w, full.h * 0.62); // drawn once at the middle card's size, scaled for the others
    const middle = c === choices[carousel.index] && Math.abs(off) < 0.5;
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, 1 - Math.max(0, Math.abs(off) - 1) * 0.6);
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    const age = g.now - lastStep;
    if (middle && age < 0.35) ctx.scale(1 + 0.05 * Math.sin((age / 0.35) * Math.PI), 1 + 0.05 * Math.sin((age / 0.35) * Math.PI));
    ctx.translate(-r.w / 2, -r.h / 2);
    const rad = 28 * u * (r.w / full.w);
    roundRectPath(ctx, 0, 0, r.w, r.h, rad);
    ctx.fillStyle = look.bg;
    ctx.fill();
    ctx.save();
    roundRectPath(ctx, 0, 0, r.w, r.h, rad);
    ctx.clip();
    if (pic) ctx.drawImage(pic, 0, 0, r.w, r.h * 0.62);
    ctx.restore();
    ctx.lineWidth = (middle ? 10 : 5) * u;
    ctx.strokeStyle = middle ? '#ffe14d' : look.border;
    roundRectPath(ctx, 0, 0, r.w, r.h, rad);
    ctx.stroke();
    // big picture
    ctx.font = `${r.w * 0.4}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(look.icon, r.w / 2, r.h * 0.34);
    // short label (a grown-up can read it out)
    const label = look.label;
    text(ctx, label, r.w / 2, r.h * 0.81, Math.min(56 * u * (r.w / full.w), (r.w * 1.6) / Math.max(8, label.length)));
    // the arms-up ring around the middle picture
    const p = middle ? carousel.progress : 0;
    if (p > 0) {
      ctx.lineWidth = 18 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(r.w / 2, r.h * 0.34, r.w * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#7dff6b';
      ctx.beginPath();
      ctx.arc(r.w / 2, r.h * 0.34, r.w * 0.34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();
    }
    ctx.restore();
  }
  // how to scroll: a waving hand and an arrow under each side card, a little wave animation
  const y = g.H * CARDS_TOP + full.h + 48 * u;
  const wob = Math.sin(g.now * 6) * 0.25;
  for (const dir of [-1, 1]) {
    const x = g.W / 2 + dir * Math.min(g.W * 0.33, full.w * 1.25);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wob * dir);
    ctx.font = `${54 * u}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👋', 0, 0);
    ctx.restore();
    text(ctx, dir < 0 ? '◀' : '▶', x + dir * 60 * u, y, 46 * u, { color: '#ffe14d' });
  }
  // how to play: both arms up, under the middle card
  drawPoseIcon(ctx, 'armsUp', g.W / 2 - 110 * u, y + 34 * u, 84 * u, '#7dff6b');
  text(ctx, 'PLAY!', g.W / 2 + 30 * u, y, 48 * u, { color: '#7dff6b' });
}
