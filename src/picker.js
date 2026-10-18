// The level picker: a big picture card per level, chosen with the body, no reading needed.
//
// A kid holds a hand over a card and a ring fills around it (about 1.5 s). When the ring is full the card is
// chosen. Taking the hand away drains the ring at half speed, so tracking jitter never resets it (nothing pops).
// Any playing kid can choose; the first ring to fill wins. Only raised hands count (above about the shoulders'
// height), so hands hanging at a kid's sides never pick a game by accident. A grown-up can also tap or click a
// card, or use the number keys as before. The last card, "Surprise!", picks a random level.
//
// The maths (layout, ring fill, which hands count) is pure and unit-tested; the drawing is at the bottom.
/** @import { Level, Player } from './types.js' */
import { Backdrops } from './backdrops.js';
import { text } from './draw.js';

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/** @typedef {{ kind: 'level', index: number, level: Level } | { kind: 'surprise' }} Choice */

// Card height = width * ASPECT. Cards sit between TOP and BOTTOM (fractions of the screen height), leaving a
// band above for the title and below for the player count.
const ASPECT = 1.1;
const TOP = 0.15;
const BOTTOM = 0.84;

/** @param {Level[]} levels @returns {Choice[]} */
export function pickerChoices(levels) {
  return [...levels.map((level, index) => /** @type {Choice} */ ({ kind: 'level', index, level })), { kind: 'surprise' }];
}

// Lay out n cards as big as they can be: tries every column count and keeps the one with the biggest cards.
/** @returns {Rect[]} */
export function pickerLayout(n, W, H, u) {
  const pad = 40 * u;
  const gap = 34 * u;
  const areaW = W - pad * 2;
  const areaY = H * TOP;
  const areaH = H * (BOTTOM - TOP);
  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((areaW - gap * (cols - 1)) / cols, (areaH - gap * (rows - 1)) / rows / ASPECT);
    if (w > best.w) best = { cols, w };
  }
  const { cols, w } = best;
  const h = w * ASPECT;
  const rows = Math.ceil(n / cols);
  const y0 = areaY + (areaH - (rows * h + (rows - 1) * gap)) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols); // a short last row is centred
    const x0 = (W - (inRow * w + (inRow - 1) * gap)) / 2;
    rects.push({ x: x0 + (i % cols) * (w + gap), y: y0 + row * (h + gap), w, h });
  }
  return rects;
}

// The hands that can choose: wrists and fingertips of playing kids, only when raised to about shoulder height
// or higher (half a shoulder width of slack). Measured in shoulder widths, like every pose rule.
// `tip` marks the fingertips, the one point per hand that is drawn.
/** @param {Player[]} players @returns {{ x: number, y: number, player: Player, tip: boolean }[]} */
export function pickingHands(players) {
  const out = [];
  for (const p of players) {
    if (!p.hands || !p.sh) continue;
    const limit = p.sh.y + 0.5 * (p.shoulderW || 0);
    p.hands.forEach((h, k) => {
      if (h && h.y <= limit) out.push({ x: h.x, y: h.y, player: p, tip: k >= 2 });
    });
  }
  return out;
}

// Which card a point is over (forgiving: a little outside the card still counts), or -1.
/** @param {Rect[]} rects @param {{ x: number, y: number }} pt */
export function cardAt(rects, pt, slack = 0.08) {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const sx = r.w * slack;
    const sy = r.h * slack;
    if (pt.x >= r.x - sx && pt.x <= r.x + r.w + sx && pt.y >= r.y - sy && pt.y <= r.y + r.h + sy) return i;
  }
  return -1;
}

// A random level, never the one just played (when there is a choice).
export function surprisePick(n, last = -1, rand = Math.random) {
  if (n <= 1) return 0;
  let i = Math.floor(rand() * (n - 1));
  if (last >= 0 && last < n && i >= last) i++;
  return Math.min(n - 1, i);
}

export class Picker {
  /** @param {{ hold?: number, wait?: number }} [o] */
  constructor({ hold = 1.5, wait = 0.8 } = {}) {
    this.hold = hold; // seconds of hovering to choose a card
    this.wait = wait; // nothing fills for this long after the picker opens, so a hand left on a card waits its turn
    this.reset();
  }

  reset() {
    /** @type {number[]} */
    this.fill = []; // 0..1 per card
    /** @type {Set<number>} */
    this.over = new Set(); // cards with a hand on them now
    this.t = 0;
  }

  // rects: the cards; hands: points that can choose. Returns { chosen, entered }: the card whose ring just filled
  // (-1 if none) and the cards a hand has just moved onto (for a sound and a wiggle).
  /** @param {Rect[]} rects @param {{ x: number, y: number }[]} hands @param {number} dt */
  update(rects, hands, dt) {
    this.t += dt;
    const over = new Set();
    for (const h of hands) {
      const i = cardAt(rects, h);
      if (i >= 0) over.add(i);
    }
    const entered = [...over].filter((i) => !this.over.has(i));
    this.over = over;
    let chosen = -1;
    let most = 1;
    for (let i = 0; i < rects.length; i++) {
      const f = this.fill[i] ?? 0;
      if (!over.has(i)) this.fill[i] = Math.max(0, f - dt / (this.hold * 2));
      else if (this.t >= this.wait) this.fill[i] = f + dt / this.hold;
      else this.fill[i] = f;
      // first ring to fill wins; if two fill on the same frame, the fuller one
      if (this.fill[i] >= most) {
        most = this.fill[i];
        chosen = i;
      }
    }
    if (chosen >= 0) this.fill = [];
    return { chosen, entered };
  }

  progress(i) {
    return Math.min(1, this.fill[i] ?? 0);
  }
}

// ------------------------------------------------------------------ drawing (browser only)

// A small picture of each level's cartoon world, drawn once per card size.
const thumbs = { key: '', canvases: /** @type {HTMLCanvasElement[]} */ ([]) };
function thumbnails(levels, w, h) {
  const key = `${levels.length}:${Math.round(w)}x${Math.round(h)}`;
  if (thumbs.key === key) return thumbs.canvases;
  thumbs.key = key;
  thumbs.canvases = levels.map((L) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const custom = typeof L.backdrop === 'object' ? L.backdrop : undefined;
    const id = typeof L.backdrop === 'string' ? L.backdrop : L.id;
    try {
      new Backdrops().draw(c.getContext('2d'), id, c.width, c.height, 0, custom);
    } catch (e) {
      console.warn('no thumbnail for', L.id, e);
    }
    return c;
  });
  return thumbs.canvases;
}

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ W: number, H: number, u: number, now: number }} g
 * @param {Choice[]} choices @param {Rect[]} rects @param {Picker} picker
 * @param {{ x: number, y: number, player: Player, tip: boolean }[]} hands
 * @param {Record<number, number>} wiggle  card index -> time a hand moved onto it
 */
export function drawPicker(ctx, g, choices, rects, picker, hands, wiggle) {
  const u = g.u;
  const levels = choices.filter((c) => c.kind === 'level').map((c) => /** @type {any} */ (c).level);
  const pics = rects.length ? thumbnails(levels, rects[0].w, rects[0].h * 0.62) : [];
  choices.forEach((c, i) => {
    const r = rects[i];
    const on = picker.over.has(i);
    const age = g.now - (wiggle[i] ?? -9);
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    if (age < 0.5) ctx.rotate(Math.sin(age * 30) * 0.06 * (1 - age / 0.5)); // a little wiggle when a hand arrives
    if (on) ctx.scale(1.05, 1.05);
    ctx.translate(-r.w / 2, -r.h / 2);
    // card: semi-transparent so the kids behind it stay visible
    ctx.globalAlpha = 0.86;
    roundRect(ctx, 0, 0, r.w, r.h, 28 * u);
    ctx.fillStyle = c.kind === 'level' ? '#1b2340' : '#3a1f5c';
    ctx.fill();
    ctx.save();
    roundRect(ctx, 0, 0, r.w, r.h, 28 * u);
    ctx.clip();
    if (c.kind === 'level' && pics[c.index]) ctx.drawImage(pics[c.index], 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.lineWidth = (on ? 9 : 5) * u;
    ctx.strokeStyle = on ? '#ffe14d' : c.kind === 'level' ? c.level.color : '#c79bff';
    roundRect(ctx, 0, 0, r.w, r.h, 28 * u);
    ctx.stroke();
    // big picture
    ctx.font = `${r.w * 0.4}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.kind === 'level' ? c.level.icon ?? '🎮' : '🎲', r.w / 2, r.h * 0.36);
    // short label (a grown-up can read it out)
    const label = c.kind === 'level' ? c.level.title : 'Surprise!';
    text(ctx, label, r.w / 2, r.h * 0.82, Math.min(40 * u, (r.w * 1.6) / Math.max(8, label.length)));
    // the ring filling around the picture
    const p = picker.progress(i);
    if (p > 0) {
      const cx = r.w / 2;
      const cy = r.h * 0.36;
      const rad = r.w * 0.33;
      ctx.lineWidth = 16 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#7dff6b';
      ctx.beginPath();
      ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();
    }
    ctx.restore();
  });
  // where each choosing hand is, in that kid's colour, so they can see what they are pointing at
  for (const h of hands) {
    if (!h.tip) continue;
    ctx.fillStyle = h.player.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 16 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
