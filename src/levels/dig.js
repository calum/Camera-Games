// Dig Down: every jump stomps the brick under your feet (AIR Hop style, no trampoline needed), down
// through a mine made of short levels. Each level ends in a row of gold: break it and you drop through,
// "LEVEL 1 COMPLETE!", and land at the top of the next level, which is harder (tougher bricks, more metal
// and TNT). Same level contract as src/levels.js: { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
//
// The mine is a grid: column c, row r (row 0 is the top of this level, bigger = deeper). Each kid has a
// cell (col, y): the open space they stand in, above the brick (col, y+1).
//   - brick below is breakable  -> a jump stomps it (cracks, then it breaks)
//   - brick below is metal      -> a jump just clanks; step sideways
//   - stepping sideways          -> you tunnel into the next column at the same depth: you keep digging
//                                  down from where you are, never back up at the top of a column
//   - nothing below             -> the kid falls to the next brick
// The columns sit over the play space (calibrate.js), as many as fit: a narrow space gets fewer columns,
// down to a single shaft. The middle column never has metal, so digging straight down always gets through.
// The kids stay where the camera sees them, so instead of moving the kids we scroll each column of bricks
// so that the brick under a kid's feet sits at floor level. Columns without a kid follow their nearest
// neighbour, so the mine reads as one picture.
/** @import { Level } from '../types.js' */
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { rand } from './kit.js';
import { FULL_AREA } from '../calibrate.js';

export const COLS = 5; // the most bricks across the screen: wide on purpose, kids drift while jumping
const COL_STEP = 0.15; // fraction of the screen width between column middles, at least: one clear step sideways
const ROW_H = 150; // brick height in u
const LAND_DELAY = 0.25; // a stomp lands this long after the jump starts
const NEW_JUMP_GAP = 0.25; // lastJump must jump forward by this much to count as a new jump
const COL_SLACK = 0.15; // column hysteresis, as a fraction of a brick width
const FALL_STEP = 0.22; // seconds per row when falling down a shaft
const FUSE = 0.7; // seconds between stomping a TNT brick and the bang
const SCROLL_RATE = 6; // how fast a column scrolls to its new offset (per second)
const DROP_TIME = 0.6; // seconds from breaking the gold to landing in the next level
const DROP_ROWS = 7; // the next level's bricks rise up from this many rows below: the fall
const GOLD_PTS = 5;
const MESSAGE_TIME = 1.6;
const COMPLETE_TIME = 2.4; // "LEVEL 1 COMPLETE!" stays up longer than the other messages

// The levels of the mine, from the top down. The last one repeats forever, each one harder than the one
// before. rows: bricks to dig before the gold row; hp: stomps per plain brick (min, max); gem: chance of a gem;
// tnt / metal: chance per brick; puzzle: a prize under a metal cap with TNT beside it; fossil: bones, not gems.
export const LAYERS = [
  { name: 'Grass and dirt', top: '#a8713f', fill: '#8a5a32', dark: '#5e3b1e', rows: 4, hp: [1, 1], gem: 0.15, tnt: 0.05, metal: 0 },
  { name: 'Stone', top: '#b4b4bc', fill: '#85858f', dark: '#55555d', rows: 5, hp: [1, 2], gem: 0.15, tnt: 0.1, metal: 0.15 },
  { name: 'Crystal cave', top: '#b9a7ff', fill: '#6c5aa8', dark: '#3f3170', rows: 5, hp: [1, 2], gem: 0.3, tnt: 0.12, metal: 0.2, puzzle: true },
  { name: 'Dinosaur bones', top: '#e8d9b0', fill: '#a8916a', dark: '#6e5b3e', rows: 6, hp: [2, 2], gem: 0.2, tnt: 0.12, metal: 0.2, fossil: true, puzzle: true },
  { name: 'Deep rock', top: '#8a5050', fill: '#5a3030', dark: '#341a1a', rows: 6, hp: [2, 3], gem: 0.25, tnt: 0.15, metal: 0.25, puzzle: true },
];
const GOLD = { top: '#fff3a0', fill: '#f5c518', dark: '#a87b00' };

const randInt = (a, b) => Math.floor(rand(a, b + 1));
const PRIZE_PTS = { gem: 3, bone: 3, chest: 10 };
const PRIZE_ICON = { gem: '💎', bone: '🦴', chest: '💰' };

export const layerOf = (level) => LAYERS[Math.min(Math.max(0, level), LAYERS.length - 1)];

// A brick: kind 'dirt' (hp 1-3), 'metal' (can't be stomped through), 'tnt' (blows up its neighbours),
// 'chest' (3 stomps, big prize), 'gold' (the bottom of a level). `prize` is what's inside: 'gem' | 'bone' |
// 'chest' | null.
export const brick = (kind, hp = 1, prize = null) => ({ kind, hp, max: hp, prize, broken: false, shake: 0, fuse: -1 });

// The column that never has metal: the middle of the play space, so straight down always gets through.
export const safeColumn = (n) => Math.floor((n - 1) / 2);

/**
 * One level of the mine for `n` columns: its rows of bricks and, last, the gold row. The first row is plain
 * (start digging straight away); metal is never in the safe column, never side by side, and at most one in
 * three columns, so there is always a way down; one treasure chest per level; deep levels hide a prize
 * under a metal cap with TNT beside it (the only way in is to dig the neighbour and set the TNT off).
 * @param {number} level  0 = the top
 * @param {number} [n]    columns
 */
export function makeMine(level, n = COLS) {
  const layer = layerOf(level);
  const safe = safeColumn(n);
  const maxMetal = Math.floor((n - 1) / 2);
  const prizeKind = layer.fossil ? 'bone' : 'gem';
  const dirt = (prize = Math.random() < layer.gem ? prizeKind : null) => brick('dirt', randInt(layer.hp[0], layer.hp[1]), prize);
  const metalCount = (bricks) => bricks.filter((b) => b.kind === 'metal').length;
  const rows = [];
  for (let r = 0; r < layer.rows; r++) {
    const bricks = [];
    for (let c = 0; c < n; c++) {
      const canMetal = r > 0 && c !== safe && metalCount(bricks) < maxMetal && bricks[c - 1]?.kind !== 'metal';
      if (r > 0 && Math.random() < layer.tnt) bricks.push(brick('tnt', 1));
      else if (canMetal && Math.random() < layer.metal) bricks.push(brick('metal', Infinity));
      else bricks.push(dirt());
    }
    rows.push({ row: r, layer, bricks, gold: false });
  }
  let puzzle = null;
  if (layer.puzzle && n >= 3 && layer.rows >= 3) {
    const r = randInt(1, layer.rows - 2);
    const others = [...Array(n).keys()].filter((c) => c !== safe);
    const c = others[randInt(0, others.length - 1)];
    const cap = rows[r].bricks;
    for (let d = 0; d < n; d++) if (cap[d].kind === 'metal') cap[d] = dirt(); // the cap is this row's metal
    cap[c] = brick('metal', Infinity);
    const below = rows[r + 1].bricks;
    below[c] = dirt(prizeKind);
    const side = c === 0 ? 1 : c === n - 1 ? c - 1 : Math.random() < 0.5 ? c - 1 : c + 1;
    below[side] = brick('tnt', 1);
    for (const d of [c - 1, c + 1]) if (below[d]?.kind === 'metal') below[d] = dirt();
    puzzle = { r: r + 1, c };
    rows[r + 1].prizeCol = c;
  }
  // one treasure chest, below the first row, in a plain brick that isn't the puzzle's prize
  const spots = [];
  for (let r = 1; r < layer.rows; r++)
    for (let c = 0; c < n; c++) if (rows[r].bricks[c].kind === 'dirt' && !(puzzle && puzzle.r === r && puzzle.c === c)) spots.push([r, c]);
  if (spots.length) {
    const [r, c] = spots[randInt(0, spots.length - 1)];
    rows[r].bricks[c] = brick('chest', 3, 'chest');
  }
  rows.push({ row: layer.rows, layer, bricks: Array.from({ length: n }, () => brick('gold', 1)), gold: true });
  return rows;
}

/**
 * Where the columns go, in fractions of the screen width: over the play space (calibrate.js), so a kid at
 * either edge of it stands in the middle of an end column, and as many columns as fit with a clear step
 * between them (COL_STEP). A narrow space gets fewer columns, a very narrow one a single shaft. Without a
 * calibration the five columns fill the screen.
 * @param {import('../calibrate.js').PlayArea} [a]
 * @returns {{ n: number, left: number, colW: number }}
 */
export function digLayout(a = FULL_AREA) {
  const span = Math.max(0, a.x1 - a.x0);
  const n = Math.max(1, Math.min(COLS, 1 + Math.floor(span / COL_STEP + 1e-9)));
  let colW = n > 1 ? span / (n - 1) : 0.25;
  colW = Math.min(colW, 1 / n, 0.3);
  const mid = (a.x0 + a.x1) / 2;
  const left = Math.min(1 - n * colW, Math.max(0, mid - (n * colW) / 2));
  return { n, left, colW };
}

// Which column a kid at x (px from the first column's left edge) is over. Keeps the old column unless the
// kid is clearly past its edge, so a wobble on a brick boundary doesn't swap bricks.
/** @param {number} x @param {number} colW @param {number} n @param {number} [prev] */
export function pickColumn(x, colW, n, prev) {
  const raw = Math.min(n - 1, Math.max(0, Math.floor(x / colW)));
  if (prev === undefined || prev === raw) return raw;
  const left = prev * colW - COL_SLACK * colW;
  const right = (prev + 1) * colW + COL_SLACK * colW;
  return x >= left && x < right ? prev : raw;
}

/** @satisfies {Level} */
const dig = {
  id: 'dig',
  backdrop: EXTRA_SCENES.dig,
  title: 'Dig down!',
  icon: '⛏️',
  hint: 'Jump to stomp the bricks, down to the gold! Metal won\'t break: step to the side.',
  color: '#c98a4b',
  duration: 60,

  start(g) {
    const lay = digLayout(g.area ?? undefined);
    this.n = lay.n;
    this.layout = lay;
    this.level = 0; // which level of the mine
    this.above = 0; // rows dug in the levels above this one (for the depth meter)
    this.rows = makeMine(0, this.n);
    this.kids = new Map(); // player id -> { col, y, prevJump, fallT }
    this.stomps = []; // jumps waiting to land: { id, at }
    this.view = Array.from({ length: this.n }, () => -1); // row at each column's floor line (fractional while scrolling)
    this.messages = []; // big centre messages: { text, color, t, life, sub }
    this.deepest = -1; // deepest row any kid has stood in, in this level
    this.drop = -1; // s until the kids land in the next level (-1: not dropping)
    this.floorY = g.H * 0.85;
  },

  // The bottom row: gold. Below it is the next level.
  get goldRow() {
    return this.rows.length - 1;
  },

  // The brick at (c, r), or null for open air: above the top, below the gold, or a broken brick.
  cell(c, r) {
    if (r < 0 || c < 0 || c >= this.n || r >= this.rows.length) return null;
    const b = this.rows[r].bricks[c];
    return b.broken ? null : b;
  },

  update(g, dt) {
    const players = g.activePlayers();
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < m.life);

    // The floor line sits at the kids' feet (ankles), so the bricks are under them on screen.
    let feet = 0;
    let n = 0;
    for (const p of players) {
      const y = Math.max(p.px[27]?.y ?? 0, p.px[28]?.y ?? 0);
      if (y > 0) {
        feet += y;
        n++;
      }
    }
    const target = Math.min(g.H * 0.9, Math.max(g.H * 0.62, n ? feet / n : g.H * 0.85));
    this.floorY += (target - this.floorY) * Math.min(1, dt * 2);

    // Through the gold: a moment of falling, then everyone lands at the top of the next level.
    if (this.drop >= 0) {
      this.drop -= dt;
      for (const p of players) {
        const k = this.kids.get(p.id);
        if (k) k.prevJump = p.lastJump; // jumps in mid-air don't count
      }
      if (this.drop < 0) this.nextLevel();
    }

    const { left, colW } = this.cols(g);
    for (const p of players) {
      let k = this.kids.get(p.id);
      // First sight: remember the jump clock without counting an old jump as a stomp.
      if (!k) this.kids.set(p.id, (k = { col: undefined, y: -1, prevJump: p.lastJump, fallT: 0 }));
      k.col = pickColumn(p.cx - left, colW, this.n, k.col);
      if (this.drop >= 0) continue;
      // Stepping sideways at depth digs a tunnel: you keep your depth, so you never climb back up a column.
      const wall = this.cell(k.col, k.y);
      if (wall) this.tunnel(g, p, k.col, k.y, wall);
      // lastJump is refreshed every frame while a kid is in the air, so only a jump after being
      // on the ground for a moment counts as a new stomp. Holding a jump is one stomp.
      if (p.lastJump - k.prevJump > NEW_JUMP_GAP) this.stomps.push({ id: p.id, at: g.now + LAND_DELAY });
      k.prevJump = p.lastJump;
      // Gravity: nothing under you, you drop a row at a time.
      if (!this.cell(k.col, k.y) && !this.cell(k.col, k.y + 1) && k.y < this.goldRow) {
        k.fallT += dt;
        if (k.fallT >= FALL_STEP) {
          k.fallT = 0;
          k.y++;
          this.deepest = Math.max(this.deepest, k.y);
        }
      } else k.fallT = 0;
    }

    const landed = this.stomps.filter((s) => g.now >= s.at);
    this.stomps = this.stomps.filter((s) => g.now < s.at);
    for (const s of landed) {
      const p = players.find((q) => q.id === s.id);
      const k = this.kids.get(s.id);
      if (p && k && this.drop < 0) this.stomp(g, p, k);
    }

    // TNT fuses
    for (const row of this.rows) {
      for (let c = 0; c < this.n; c++) {
        const b = row.bricks[c];
        if (b.fuse < 0) continue;
        b.fuse -= dt;
        if (b.fuse <= 0) this.explode(g, c, row.row, b.lit);
      }
    }

    // Each column scrolls so its owner's brick-under-the-feet sits on the floor line. Empty
    // columns follow the nearest column that has a kid in it.
    const owner = Array.from({ length: this.n }, () => null);
    for (const p of players) {
      const k = this.kids.get(p.id);
      if (k && (owner[k.col] === null || k.y > owner[k.col])) owner[k.col] = k.y;
    }
    for (let c = 0; c < this.n; c++) {
      let t = owner[c];
      for (let d = 1; t === null && d < this.n; d++) t = owner[c - d] ?? owner[c + d] ?? null;
      if (t === null) continue;
      this.view[c] += (t - this.view[c]) * Math.min(1, dt * SCROLL_RATE);
    }
    for (const row of this.rows) for (const b of row.bricks) b.shake = Math.max(0, b.shake - dt);
  },

  // A stomp lands on the brick below.
  stomp(g, p, k) {
    const x = this.colX(g, k.col);
    const b = this.cell(k.col, k.y + 1);
    if (!b) return; // mid-fall
    if (b.fuse >= 0) return; // already lit
    if (b.kind === 'metal') {
      b.shake = 0.2;
      g.burst(x, this.floorY, '#dde', 6);
      sfx.clank();
      return;
    }
    b.hp--;
    b.shake = 0.25;
    if (b.hp > 0) {
      g.burst(x, this.floorY, this.rows[k.y + 1].layer.top, 8);
      sfx.crunch();
      return;
    }
    if (b.kind === 'tnt') return this.light(b, p);
    this.breakBrick(g, p, k.col, k.y + 1, b);
  },

  // The bang comes a moment later: time to see it coming.
  light(b, p) {
    b.hp = 1;
    b.fuse = FUSE;
    b.lit = p;
    sfx.fizz();
  },

  // A kid stepped sideways into a brick: they dig through it on the way (its prize too, but no stomp point,
  // so walking back and forth isn't a way to score). TNT in the way is lit; even metal gives way sideways,
  // so a step to the side is always a way round.
  tunnel(g, p, c, r, b) {
    if (b.kind === 'tnt') {
      if (b.fuse < 0) this.light(b, p);
      return;
    }
    this.breakBrick(g, p, c, r, b, { tunnel: true });
  },

  breakBrick(g, p, c, r, b, { tunnel = false } = {}) {
    const u = g.u;
    const x = this.colX(g, c);
    const y = this.cellY(g, c, r) + (ROW_H * u) / 2;
    b.broken = true;
    b.fuse = -1;
    if (b.kind === 'gold') return this.throughGold(g, p, x, y);
    const pts = (tunnel ? 0 : 1) + (PRIZE_PTS[b.prize] ?? 0);
    if (pts) g.score(p, pts, x, y - 80 * u);
    g.burst(x, y, b.kind === 'metal' ? '#dde' : this.rows[r].layer.fill, tunnel ? 10 : 18);
    if (b.prize === 'chest') {
      g.burst(x, y, '#ffd24d', 40);
      sfx.fanfare();
      this.say('TREASURE!', '#ffd24d');
    } else if (b.prize) {
      g.burst(x, y, '#7fe3ff', 20);
      sfx.gold();
    } else sfx.crumble();
  },

  // A gold brick broke: this level of the mine is done. The kids fall through to the next one.
  throughGold(g, p, x, y) {
    if (this.drop >= 0) return;
    g.score(p, GOLD_PTS, x, y - 80 * g.u);
    g.burst(x, y, '#ffd24d', 50);
    g.burst(x, y, '#ffffff', 20);
    sfx.fanfare();
    this.say(`LEVEL ${this.level + 1} COMPLETE!`, '#ffd24d', { life: COMPLETE_TIME, sub: `down to ${layerOf(this.level + 1).name}...` });
    this.drop = DROP_TIME;
    this.stomps = [];
  },

  // Land at the top of the next level: a fresh mine, harder than the last, rising up from below (the fall).
  nextLevel() {
    this.above += this.rows.length;
    this.level++;
    this.rows = makeMine(this.level, this.n);
    this.deepest = -1;
    this.drop = -1;
    for (const k of this.kids.values()) {
      k.y = -1;
      k.fallT = 0;
    }
    this.view = this.view.map(() => -1 - DROP_ROWS);
    sfx.thud();
  },

  // TNT at (c, r) blows up the bricks beside and below it (not metal). TNT caught in the blast
  // goes off too, straight away. The kid who lit it gets the points.
  explode(g, c, r, p) {
    const u = g.u;
    const b = this.rows[r].bricks[c];
    b.fuse = -1;
    b.broken = true;
    g.burst(this.colX(g, c), this.cellY(g, c, r) + (ROW_H * u) / 2, '#ff7a3d', 40);
    sfx.kaboom();
    g.score(p, 1, this.colX(g, c), this.cellY(g, c, r) - 40 * u);
    for (const [dc, dr] of [[-1, 0], [1, 0], [0, 1]]) {
      const n = this.cell(c + dc, r + dr);
      if (!n || n.kind === 'metal') continue;
      if (n.kind === 'tnt') this.explode(g, c + dc, r + dr, p);
      else this.breakBrick(g, p, c + dc, r + dr, n);
    }
  },

  say(str, color, { life = MESSAGE_TIME, sub = '' } = {}) {
    this.messages.push({ text: str, color, t: 0, life, sub });
  },

  // The columns on screen, in px: the left edge of the first one and their width.
  cols(g) {
    return { left: this.layout.left * g.W, colW: this.layout.colW * g.W };
  },

  colX(g, c) {
    const { left, colW } = this.cols(g);
    return left + (c + 0.5) * colW;
  },

  // Screen y of the top of cell (c, r): the brick under a kid's feet (row view+1) sits on the floor line.
  cellY(g, c, r) {
    return this.floorY + (r - this.view[c] - 1) * ROW_H * g.u;
  },

  draw(g, ctx) {
    const u = g.u;
    const { left, colW } = this.cols(g);
    const rowH = ROW_H * u;
    const players = g.activePlayers();

    // Darker the deeper you go: you're down a hole now.
    const dark = Math.min(0.55, this.level * 0.12 + (this.deepest + 1) * 0.02);
    if (dark > 0) {
      ctx.fillStyle = `rgba(30,18,8,${dark})`;
      ctx.fillRect(0, 0, g.W, g.H);
    }

    for (let c = 0; c < this.n; c++) {
      for (let r = 0; r < this.rows.length; r++) {
        const y = this.cellY(g, c, r);
        if (y + rowH < 0) continue;
        if (y > g.H) break;
        const row = this.rows[r];
        const b = row.bricks[c];
        if (b.broken) {
          ctx.fillStyle = 'rgba(10,6,3,0.85)'; // the hole
          ctx.fillRect(left + c * colW, y, colW, rowH);
          continue;
        }
        const shake = b.shake > 0 ? Math.sin(g.now * 60 + c) * 6 * u : 0;
        const x = left + c * colW + shake;
        const metal = b.kind === 'metal';
        const tnt = b.kind === 'tnt';
        const gold = b.kind === 'gold';
        const look = gold ? GOLD : row.layer;
        ctx.fillStyle = metal ? '#9aa3ad' : tnt ? '#d8362b' : look.fill;
        ctx.fillRect(x + 3 * u, y + 3 * u, colW - 6 * u, rowH - 6 * u);
        ctx.fillStyle = metal ? '#d5dbe2' : tnt ? '#ff6a5a' : r === 0 && this.level === 0 ? '#5fd35f' : look.top; // grass on the very top only
        ctx.fillRect(x + 3 * u, y + 3 * u, colW - 6 * u, 18 * u);
        ctx.strokeStyle = metal ? '#4e565e' : tnt ? '#7a1a12' : look.dark;
        ctx.lineWidth = 6 * u;
        ctx.strokeRect(x + 3 * u, y + 3 * u, colW - 6 * u, rowH - 6 * u);
        if (metal) {
          // rivets
          ctx.fillStyle = '#4e565e';
          for (const [dx, dy] of [[0.15, 0.3], [0.85, 0.3], [0.15, 0.8], [0.85, 0.8]]) {
            ctx.beginPath();
            ctx.arc(x + colW * dx, y + rowH * dy, 9 * u, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (tnt) {
          const lit = b.fuse >= 0 && Math.sin(g.now * 40) > 0;
          text(ctx, 'TNT', x + colW / 2, y + rowH * 0.58, 56 * u, { color: lit ? '#fff' : '#ffe14d' });
          if (b.fuse >= 0) text(ctx, '💥', x + colW / 2, y - 30 * u, 64 * u);
        } else if (gold) {
          // a gold bar with a glint running along it
          const glint = (g.now * 0.8 + c * 0.15) % 1;
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fillRect(x + colW * (0.1 + 0.7 * glint), y + 12 * u, colW * 0.08, rowH - 24 * u);
          text(ctx, '⭐', x + colW / 2, y + rowH / 2 + 8 * u, 56 * u);
        } else {
          // cracks: one more zig-zag per stomp taken
          ctx.lineWidth = 5 * u;
          for (let k = 0; k < b.max - b.hp; k++) {
            const cx = x + colW * (0.3 + 0.4 * k);
            ctx.beginPath();
            ctx.moveTo(cx, y + 20 * u);
            ctx.lineTo(cx + 30 * u, y + rowH * 0.35);
            ctx.lineTo(cx - 20 * u, y + rowH * 0.6);
            ctx.lineTo(cx + 15 * u, y + rowH - 10 * u);
            ctx.stroke();
          }
          if (b.prize) text(ctx, PRIZE_ICON[b.prize], x + colW / 2, y + rowH / 2 + 8 * u, (b.prize === 'chest' ? 90 : 64) * u);
        }
      }
    }

    // What each kid's next jump does, in their colour: the brick they'll stomp, or a "step to the side"
    // arrow on metal (towards the middle column, which never has metal).
    for (const p of players) {
      const k = this.kids.get(p.id);
      if (!k || k.col === undefined || this.drop >= 0) continue;
      const b = this.cell(k.col, k.y + 1);
      if (!b) continue;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 10 * u;
      const y = this.cellY(g, k.col, k.y + 1);
      ctx.strokeRect(left + k.col * colW + 8 * u, y + 8 * u, colW - 16 * u, rowH - 16 * u);
      if (b.kind === 'metal') {
        const safe = safeColumn(this.n);
        const toLeft = k.col > safe || (k.col === safe && k.col > 0);
        text(ctx, toLeft ? '⬅' : '➡', this.colX(g, k.col), this.floorY - rowH * 0.5, 110 * u, { color: p.color });
      }
    }

    // Level and depth down the left side.
    const depth = Math.max(0, this.above + this.deepest + 1);
    text(ctx, `Level ${this.level + 1}`, 30 * u, g.H * 0.3 - 70 * u, 50 * u, { align: 'left', color: '#fff' });
    text(ctx, `${depth * 2} m`, 30 * u, g.H * 0.3, 64 * u, { align: 'left', color: '#ffe14d' });
    text(ctx, 'deep', 30 * u, g.H * 0.3 + 60 * u, 36 * u, { align: 'left' });
    const toGold = this.goldRow - Math.max(0, this.deepest + 1);
    if (this.drop < 0) text(ctx, toGold > 0 ? `⭐ in ${toGold}` : '⭐ next!', 30 * u, g.H * 0.3 + 120 * u, 40 * u, { align: 'left' });

    for (const m of this.messages) {
      const a = m.t / m.life;
      ctx.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      const size = (m.sub ? 120 : 150) * u * (1 + 0.4 * Math.max(0, 1 - m.t * 5));
      text(ctx, m.text, g.W / 2, g.H * 0.3, size, { color: m.color });
      if (m.sub) text(ctx, m.sub, g.W / 2, g.H * 0.3 + 100 * u, 56 * u, { color: '#fff' });
      ctx.globalAlpha = 1;
    }
  },
};

export default dig;
