// Dig Down: every jump stomps the brick under your feet, and each column is its own shaft
// (AIR Hop style, no trampoline needed). Same level contract as src/levels.js:
//   { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
//
// The mine is a grid: column c, row r (row 0 is the surface, bigger = deeper). Each kid has a
// cell (col, y): the open space they stand in, above the brick (col, y+1).
//   - brick below is breakable  -> a jump stomps it (cracks, then it breaks)
//   - brick below is metal      -> a jump just clanks; go round it
//   - the kid's own cell is solid (they stepped sideways into a wall) -> a jump climbs up one brick
//   - nothing below             -> the kid falls to the next brick
// The kids stay where the camera sees them, so instead of moving the kids we scroll each
// column of bricks so that the brick under a kid's feet sits at floor level. Columns without
// a kid follow their nearest neighbour, so the mine reads as one picture.
/** @import { Level } from '../types.js' */
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { sfx } from '../audio.js';
import { text } from '../draw.js';

export const COLS = 5; // bricks across the screen: wide on purpose, kids drift while jumping
const ROW_H = 150; // brick height in u
const LAND_DELAY = 0.25; // a stomp lands this long after the jump starts
const NEW_JUMP_GAP = 0.25; // lastJump must jump forward by this much to count as a new jump
const COL_SLACK = 0.15; // column hysteresis, as a fraction of a brick width
const FALL_STEP = 0.22; // seconds per row when falling down a shaft
const FUSE = 0.7; // seconds between stomping a TNT brick and the bang
const SCROLL_RATE = 6; // how fast a column scrolls to its new offset (per second)
const ROWS_PER_LAYER = 3;
const TREASURE_EVERY = 6; // a treasure chest every 6th row
const PUZZLE_EVERY = 4; // deep down, every 4th row hides a prize under a metal cap
const MESSAGE_TIME = 1.6;

// Layers from the surface down. The last one repeats forever.
//   hp: stomps per plain brick (min, max)   gem: chance of a gem in a plain brick
//   tnt / metal: chance per brick           puzzle: prize under a metal cap, TNT beside it
export const LAYERS = [
  { name: 'Grass', top: '#a8713f', fill: '#8a5a32', dark: '#5e3b1e', hp: [1, 1], gem: 0.1, tnt: 0, metal: 0 },
  { name: 'Dirt', top: '#a8713f', fill: '#7a4e2a', dark: '#4f3119', hp: [1, 1], gem: 0.15, tnt: 0.08, metal: 0 },
  { name: 'Stone', top: '#b4b4bc', fill: '#85858f', dark: '#55555d', hp: [1, 2], gem: 0.15, tnt: 0.1, metal: 0.1 },
  { name: 'Crystal cave', top: '#b9a7ff', fill: '#6c5aa8', dark: '#3f3170', hp: [2, 2], gem: 0.3, tnt: 0.12, metal: 0.15, puzzle: true },
  { name: 'Dinosaur bones', top: '#e8d9b0', fill: '#a8916a', dark: '#6e5b3e', hp: [2, 2], gem: 0.2, tnt: 0.12, metal: 0.2, fossil: true, puzzle: true },
  { name: 'Deep rock', top: '#8a5050', fill: '#5a3030', dark: '#341a1a', hp: [2, 3], gem: 0.25, tnt: 0.15, metal: 0.25, puzzle: true },
];

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const PRIZE_PTS = { gem: 3, bone: 3, chest: 10 };
const PRIZE_ICON = { gem: '💎', bone: '🦴', chest: '💰' };

export const layerAt = (row) => LAYERS[Math.min(Math.floor(Math.max(0, row) / ROWS_PER_LAYER), LAYERS.length - 1)];

// A brick: kind 'dirt' (hp 1-3), 'metal' (can't be broken), 'tnt' (blows up its neighbours),
// 'chest' (3 stomps, big prize). `prize` is what's inside: 'gem' | 'bone' | 'chest' | null.
export const brick = (kind, hp = 1, prize = null) => ({ kind, hp, max: hp, prize, broken: false, shake: 0, fuse: -1 });

// One row of bricks. `plan` carries the puzzle from the row above: { prizeCol } means this row's
// brick in that column is a prize (under last row's metal cap) and a TNT sits next to it, so the
// only way in is to dig the neighbour column and set the TNT off.
export function makeRow(row, plan = {}) {
  const layer = layerAt(row);
  const bricks = [];
  let metal = 0;
  for (let c = 0; c < COLS; c++) {
    const prizeKind = layer.fossil ? 'bone' : 'gem';
    // at most 2 metal bricks per row and never two side by side, so there is always a way down
    const canMetal = metal < 2 && bricks[c - 1]?.kind !== 'metal';
    if (Math.random() < layer.tnt) bricks.push(brick('tnt', 1));
    else if (canMetal && Math.random() < layer.metal) {
      bricks.push(brick('metal', Infinity));
      metal++;
    } else bricks.push(brick('dirt', rollHp(), Math.random() < layer.gem ? prizeKind : null));
  }
  const next = {};
  if (plan.prizeCol !== undefined) {
    const c = plan.prizeCol;
    bricks[c] = (row + 1) % TREASURE_EVERY === 0 ? brick('chest', 3, 'chest') : brick('dirt', rollHp(), layer.fossil ? 'bone' : 'gem');
    const side = c > 0 && (c === COLS - 1 || Math.random() < 0.5) ? c - 1 : c + 1;
    bricks[side] = brick('tnt', 1);
    if (bricks[c - 1]?.kind === 'metal') bricks[c - 1] = brick('dirt', rollHp());
    if (bricks[c + 1]?.kind === 'metal') bricks[c + 1] = brick('dirt', rollHp());
  } else if (layer.puzzle && row % PUZZLE_EVERY === 0) {
    const c = randInt(0, COLS - 1);
    bricks[c] = brick('metal', Infinity);
    for (const d of [-1, 1]) if (bricks[c + d]?.kind === 'metal') bricks[c + d] = brick('dirt', rollHp());
    // the cap counts towards the 2-metal limit
    for (let d = 0; d < COLS && bricks.filter((b) => b.kind === 'metal').length > 2; d++) {
      if (d !== c && bricks[d].kind === 'metal') bricks[d] = brick('dirt', rollHp());
    }
    next.prizeCol = c;
  } else if ((row + 1) % TREASURE_EVERY === 0) {
    bricks[randInt(0, COLS - 1)] = brick('chest', 3, 'chest');
  }
  return { row, layer, bricks, next };

  function rollHp() {
    return randInt(layer.hp[0], layer.hp[1]);
  }
}

// Which column a kid at x is over. Keeps the old column unless the kid is clearly past its edge,
// so a wobble on a brick boundary doesn't swap bricks.
export function pickColumn(x, W, prev) {
  const colW = W / COLS;
  const raw = Math.min(COLS - 1, Math.max(0, Math.floor(x / colW)));
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
  hint: 'Jump to stomp the bricks. Metal won\'t break, so go round. TNT goes BANG!',
  color: '#c98a4b',
  duration: 60,

  start(g) {
    this.rows = []; // rows[r] = row r of the mine, generated as needed
    this.plan = {};
    this.kids = new Map(); // player id -> { col, y, prevJump, fallT }
    this.stomps = []; // jumps waiting to land: { id, at }
    this.view = Array.from({ length: COLS }, () => -1); // row at each column's floor line (fractional while scrolling)
    this.messages = []; // big centre messages: { text, color, t }
    this.deepest = -1; // deepest row any kid has stood in
    this.announced = new Set(['Grass']); // layers whose name has been shown
    this.floorY = g.H * 0.85;
    this.ensureRows(8);
  },

  ensureRows(n) {
    while (this.rows.length < n) {
      const r = makeRow(this.rows.length, this.plan);
      this.plan = r.next;
      this.rows.push(r);
    }
  },

  // The brick at (c, r), or null for open air: above ground, or a broken brick.
  cell(c, r) {
    if (r < 0 || c < 0 || c >= COLS) return null;
    this.ensureRows(r + 1);
    const b = this.rows[r].bricks[c];
    return b.broken ? null : b;
  },

  update(g, dt) {
    const players = g.activePlayers();
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < MESSAGE_TIME);

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

    for (const p of players) {
      let k = this.kids.get(p.id);
      // First sight: remember the jump clock without counting an old jump as a stomp.
      if (!k) this.kids.set(p.id, (k = { col: undefined, y: -1, prevJump: p.lastJump, fallT: 0 }));
      k.col = pickColumn(p.cx, g.W, k.col);
      // lastJump is refreshed every frame while a kid is in the air, so only a jump after being
      // on the ground for a moment counts as a new stomp. Holding a jump is one stomp.
      if (p.lastJump - k.prevJump > NEW_JUMP_GAP) this.stomps.push({ id: p.id, at: g.now + LAND_DELAY });
      k.prevJump = p.lastJump;
      // Gravity: standing in open air with nothing under you, you drop a row at a time.
      if (!this.cell(k.col, k.y) && !this.cell(k.col, k.y + 1)) {
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
      if (p && k) this.stomp(g, p, k);
    }

    // TNT fuses
    for (const row of this.rows) {
      for (let c = 0; c < COLS; c++) {
        const b = row.bricks[c];
        if (b.fuse < 0) continue;
        b.fuse -= dt;
        if (b.fuse <= 0) this.explode(g, c, row.row, b.lit);
      }
    }

    // Each column scrolls so its owner's brick-under-the-feet sits on the floor line. Empty
    // columns follow the nearest column that has a kid in it.
    const owner = Array.from({ length: COLS }, () => null);
    for (const k of this.kids.values()) {
      if (!players.some((p) => this.kids.get(p.id) === k)) continue;
      if (owner[k.col] === null || k.y > owner[k.col]) owner[k.col] = k.y;
    }
    for (let c = 0; c < COLS; c++) {
      let t = owner[c];
      for (let d = 1; t === null && d < COLS; d++) t = owner[c - d] ?? owner[c + d] ?? null;
      if (t === null) continue;
      this.view[c] += (t - this.view[c]) * Math.min(1, dt * SCROLL_RATE);
    }
    for (const row of this.rows) for (const b of row.bricks) b.shake = Math.max(0, b.shake - dt);
    this.ensureRows(this.deepest + 8);
  },

  // A stomp lands. Inside a wall: climb. Otherwise hit the brick below.
  stomp(g, p, k) {
    const u = g.u;
    const x = this.colX(g, k.col);
    if (this.cell(k.col, k.y)) {
      k.y--;
      g.burst(x, this.floorY - ROW_H * u * 0.5, '#ffffff', 6);
      sfx.tick();
      return;
    }
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
    if (b.kind === 'tnt') {
      // The bang comes a moment later: time to see it coming.
      b.hp = 1;
      b.fuse = FUSE;
      b.lit = p;
      sfx.fizz();
      return;
    }
    this.breakBrick(g, p, k.col, k.y + 1, b);
  },

  breakBrick(g, p, c, r, b) {
    const u = g.u;
    const x = this.colX(g, c);
    const y = this.cellY(g, c, r) + (ROW_H * u) / 2;
    b.broken = true;
    const pts = 1 + (PRIZE_PTS[b.prize] ?? 0);
    g.score(p, pts, x, y - 80 * u);
    g.burst(x, y, this.rows[r].layer.fill, 18);
    if (b.prize === 'chest') {
      g.burst(x, y, '#ffd24d', 40);
      sfx.fanfare();
      this.say('TREASURE!', '#ffd24d');
    } else if (b.prize) {
      g.burst(x, y, '#7fe3ff', 20);
      sfx.gold();
    } else sfx.crumble();
    const layer = this.rows[r].layer;
    if (!this.announced.has(layer.name)) {
      this.announced.add(layer.name);
      this.say(`${layer.name}!`, layer.top);
    }
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

  say(str, color) {
    this.messages.push({ text: str, color, t: 0 });
  },

  colX(g, c) {
    return (c + 0.5) * (g.W / COLS);
  },

  // Screen y of the top of cell (c, r): the brick under a kid's feet (row view+1) sits on the floor line.
  cellY(g, c, r) {
    return this.floorY + (r - this.view[c] - 1) * ROW_H * g.u;
  },

  draw(g, ctx) {
    const u = g.u;
    const colW = g.W / COLS;
    const rowH = ROW_H * u;
    const players = g.activePlayers();

    // Darker the deeper you go: you're down a hole now.
    const dark = Math.min(0.55, (this.deepest + 1) * 0.04);
    if (dark > 0) {
      ctx.fillStyle = `rgba(30,18,8,${dark})`;
      ctx.fillRect(0, 0, g.W, g.H);
    }

    for (let c = 0; c < COLS; c++) {
      const first = Math.max(0, Math.floor(this.view[c] - (this.floorY / rowH) + 1));
      for (let r = first; ; r++) {
        const y = this.cellY(g, c, r);
        if (y > g.H) break;
        this.ensureRows(r + 1);
        const row = this.rows[r];
        const b = row.bricks[c];
        if (b.broken) {
          ctx.fillStyle = 'rgba(10,6,3,0.85)'; // the hole
          ctx.fillRect(c * colW, y, colW, rowH);
          continue;
        }
        const shake = b.shake > 0 ? Math.sin(g.now * 60 + c) * 6 * u : 0;
        const x = c * colW + shake;
        const metal = b.kind === 'metal';
        const tnt = b.kind === 'tnt';
        ctx.fillStyle = metal ? '#9aa3ad' : tnt ? '#d8362b' : row.layer.fill;
        ctx.fillRect(x + 3 * u, y + 3 * u, colW - 6 * u, rowH - 6 * u);
        ctx.fillStyle = metal ? '#d5dbe2' : tnt ? '#ff6a5a' : r === 0 ? '#5fd35f' : row.layer.top; // grass on the surface only
        ctx.fillRect(x + 3 * u, y + 3 * u, colW - 6 * u, 18 * u);
        ctx.strokeStyle = metal ? '#4e565e' : tnt ? '#7a1a12' : row.layer.dark;
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

    // What each kid's next jump does, in their colour: the brick they'll stomp, an up arrow
    // when they're climbing, or a "go round" arrow on metal.
    for (const p of players) {
      const k = this.kids.get(p.id);
      if (!k || k.col === undefined) continue;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 10 * u;
      const x = this.colX(g, k.col);
      if (this.cell(k.col, k.y)) {
        text(ctx, '⬆', x, this.floorY - rowH * 0.5, 110 * u, { color: p.color });
      } else {
        const b = this.cell(k.col, k.y + 1);
        if (!b) continue;
        const y = this.cellY(g, k.col, k.y + 1);
        ctx.strokeRect(k.col * colW + 8 * u, y + 8 * u, colW - 16 * u, rowH - 16 * u);
        if (b.kind === 'metal') {
          const left = k.col > 0 && (k.col === COLS - 1 || this.cell(k.col - 1, k.y + 1)?.kind !== 'metal');
          text(ctx, left ? '⬅' : '➡', x, this.floorY - rowH * 0.5, 110 * u, { color: p.color });
        }
      }
    }

    // Depth meter down the left side.
    const depth = Math.max(0, this.deepest + 1);
    text(ctx, `${depth * 2} m`, 30 * u, g.H * 0.3, 64 * u, { align: 'left', color: '#ffe14d' });
    text(ctx, 'deep', 30 * u, g.H * 0.3 + 60 * u, 36 * u, { align: 'left' });
    const toChest = TREASURE_EVERY - 1 - (depth % TREASURE_EVERY);
    if (toChest > 0) text(ctx, `💰 in ${toChest}`, 30 * u, g.H * 0.3 + 120 * u, 40 * u, { align: 'left' });

    for (const m of this.messages) {
      const a = m.t / MESSAGE_TIME;
      ctx.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      text(ctx, m.text, g.W / 2, g.H * 0.3, 150 * u * (1 + 0.4 * Math.max(0, 1 - m.t * 5)), { color: m.color });
      ctx.globalAlpha = 1;
    }
  },
};

export default dig;
