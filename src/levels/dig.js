// Dig Down: every jump stomps the brick under your feet. Break enough of a row and the whole
// row crumbles, the world scrolls up and you dig one layer deeper (AIR Hop style, no trampoline).
// Same level contract as src/levels.js: { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }.
// Kids stay where they are on screen; the bricks under their feet move instead.
import { sfx } from '../audio.js';
import { text } from '../draw.js';

const COLS = 5; // bricks across the screen: wide on purpose, kids drift while jumping
const ROW_H = 150; // brick height in u
const CLEAR_AT = 3; // bricks broken in a row before the rest crumble
const CRUMBLE_TIME = 0.6; // seconds the row shakes before it falls away
const DROP_TIME = 0.5; // seconds for the world to scroll up one row
const LAND_DELAY = 0.25; // a stomp lands this long after the jump starts
const NEW_JUMP_GAP = 0.25; // lastJump must jump forward by this much to count as a new jump
const COL_SLACK = 0.15; // column hysteresis, as a fraction of a brick width
const ROWS_PER_LAYER = 2;
const TREASURE_EVERY = 6; // every 6th row hides a treasure chest
const MESSAGE_TIME = 1.6;

// Layers from the surface down. hp = stomps per brick. After the last, it stays deep rock.
const LAYERS = [
  { name: 'Grass', top: '#5fd35f', fill: '#8a5a32', dark: '#5e3b1e', hp: [1, 1], gem: 0.1 },
  { name: 'Dirt', top: '#a8713f', fill: '#7a4e2a', dark: '#4f3119', hp: [1, 1], gem: 0.15 },
  { name: 'Stone', top: '#b4b4bc', fill: '#85858f', dark: '#55555d', hp: [1, 2], gem: 0.15 },
  { name: 'Crystal cave', top: '#b9a7ff', fill: '#6c5aa8', dark: '#3f3170', hp: [2, 2], gem: 0.35 },
  { name: 'Dinosaur bones', top: '#e8d9b0', fill: '#a8916a', dark: '#6e5b3e', hp: [2, 2], gem: 0.2, fossil: true },
  { name: 'Deep rock', top: '#8a5050', fill: '#5a3030', dark: '#341a1a', hp: [2, 3], gem: 0.25 },
];

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

export const layerAt = (depth) => LAYERS[Math.min(Math.floor(depth / ROWS_PER_LAYER), LAYERS.length - 1)];

// One row of bricks at `depth` (0 = the surface).
export function makeRow(depth) {
  const layer = layerAt(depth);
  const chest = (depth + 1) % TREASURE_EVERY === 0 ? randInt(0, COLS - 1) : -1;
  const bricks = [];
  for (let c = 0; c < COLS; c++) {
    const hp = c === chest ? 3 : randInt(layer.hp[0], layer.hp[1]);
    const prize = c === chest ? 'chest' : Math.random() < layer.gem ? (layer.fossil ? 'bone' : 'gem') : null;
    bricks.push({ hp, max: hp, prize, broken: false, shake: 0 });
  }
  return { depth, layer, bricks, crumble: -1 };
}

// Which brick a kid at x is standing on. Keeps the old column unless the kid is clearly past its edge,
// so a wobble on a brick boundary doesn't swap bricks.
export function pickColumn(x, W, prev) {
  const colW = W / COLS;
  const raw = Math.min(COLS - 1, Math.max(0, Math.floor(x / colW)));
  if (prev === undefined || prev === raw) return raw;
  const left = prev * colW - COL_SLACK * colW;
  const right = (prev + 1) * colW + COL_SLACK * colW;
  return x >= left && x < right ? prev : raw;
}

const PRIZE_PTS = { gem: 3, bone: 3, chest: 10 };
const PRIZE_ICON = { gem: '💎', bone: '🦴', chest: '💰' };

const dig = {
  id: 'dig',
  title: 'Dig down!',
  hint: 'Jump to stomp the bricks. Dig deeper and find the treasure!',
  color: '#c98a4b',
  duration: 45,

  start(g) {
    this.depth = 0; // rows dug so far
    this.rows = [makeRow(0), makeRow(1), makeRow(2), makeRow(3), makeRow(4), makeRow(5)];
    this.kids = new Map(); // player id -> { col, prevJump }
    this.stomps = []; // jumps waiting to land: { id, at }
    this.drop = 0; // 1 -> 0 while the world scrolls up after a row falls
    this.messages = []; // big centre messages: { text, color, t }
    this.floorY = g.H * 0.85;
  },

  update(g, dt) {
    const players = g.activePlayers();
    this.drop = Math.max(0, this.drop - dt / DROP_TIME);
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < MESSAGE_TIME);

    // The floor sits at the kids' feet (ankles), so the bricks are under them on screen.
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
      if (!k) this.kids.set(p.id, (k = { col: undefined, prevJump: p.lastJump }));
      k.col = pickColumn(p.cx, g.W, k.col);
      // lastJump is refreshed every frame while a kid is in the air, so only a jump after being
      // on the ground for a moment counts as a new stomp. Holding a jump is one stomp.
      if (p.lastJump - k.prevJump > NEW_JUMP_GAP) this.stomps.push({ id: p.id, at: g.now + LAND_DELAY });
      k.prevJump = p.lastJump;
    }

    const row = this.rows[0];
    const landed = this.stomps.filter((s) => g.now >= s.at);
    this.stomps = this.stomps.filter((s) => g.now < s.at);
    if (row.crumble < 0) {
      for (const s of landed) {
        const p = players.find((q) => q.id === s.id);
        const k = this.kids.get(s.id);
        if (p && k) this.stomp(g, p, k.col);
      }
    }

    if (row.crumble >= 0) {
      row.crumble += dt;
      if (row.crumble >= CRUMBLE_TIME) this.fall(g);
    }
    for (const r of this.rows) for (const b of r.bricks) b.shake = Math.max(0, b.shake - dt);
  },

  // A stomp lands on column `col` of the top row.
  stomp(g, p, col) {
    const row = this.rows[0];
    // Standing over a hole: the cracks spread to the nearest brick, so a kid who never moves
    // (a toddler, say) still digs. Moving to the gem brick is still the way to get the gem.
    let c = col;
    if (row.bricks[c].broken) {
      c = -1;
      for (let d = 1; d < COLS && c < 0; d++) {
        if (row.bricks[col - d] && !row.bricks[col - d].broken) c = col - d;
        else if (row.bricks[col + d] && !row.bricks[col + d].broken) c = col + d;
      }
      if (c < 0) return;
    }
    const b = row.bricks[c];
    const x = this.colX(g, c);
    b.hp--;
    b.shake = 0.25;
    if (b.hp > 0) {
      g.burst(x, this.floorY, row.layer.top, 8);
      sfx.tick();
      return;
    }
    b.broken = true;
    const pts = 1 + (PRIZE_PTS[b.prize] ?? 0);
    g.score(p, pts, x, this.floorY - 80 * g.u);
    g.burst(x, this.floorY, row.layer.fill, 18);
    if (b.prize === 'chest') {
      g.burst(x, this.floorY, '#ffd24d', 40);
      sfx.fanfare();
      this.say('TREASURE!', '#ffd24d');
    } else if (b.prize) {
      g.burst(x, this.floorY, '#7fe3ff', 20);
      sfx.gold();
    } else sfx.pop();
    if (row.bricks.filter((q) => q.broken).length >= CLEAR_AT) {
      row.crumble = 0;
      for (const q of row.bricks) if (!q.broken) q.shake = CRUMBLE_TIME;
    }
  },

  // The top row falls away (prizes left in it go to the team), and everyone drops a layer.
  fall(g) {
    const row = this.rows.shift();
    for (let c = 0; c < COLS; c++) {
      const b = row.bricks[c];
      if (b.broken) continue;
      const x = this.colX(g, c);
      g.burst(x, this.floorY, row.layer.fill, 10);
      if (b.prize) g.score(null, PRIZE_PTS[b.prize], x, this.floorY - 80 * g.u);
    }
    this.depth++;
    this.rows.push(makeRow(this.rows[this.rows.length - 1].depth + 1));
    this.drop = 1;
    sfx.whoosh();
    if (this.rows[0].layer !== row.layer) this.say(`${this.rows[0].layer.name}!`, this.rows[0].layer.top);
  },

  say(str, color) {
    this.messages.push({ text: str, color, t: 0 });
  },

  colX(g, c) {
    return (c + 0.5) * (g.W / COLS);
  },

  draw(g, ctx) {
    const u = g.u;
    const colW = g.W / COLS;
    const rowH = ROW_H * u;
    const top = this.floorY + this.drop * rowH; // the new row rises into place after a fall

    // The deeper you go, the darker it gets above the floor (you're down a hole now).
    const dark = Math.min(0.55, this.depth * 0.05);
    if (dark > 0) {
      ctx.fillStyle = `rgba(30,18,8,${dark})`;
      ctx.fillRect(0, 0, g.W, top);
    }

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const y = top + i * rowH;
      if (y > g.H) break;
      for (let c = 0; c < COLS; c++) {
        const b = row.bricks[c];
        const shake = b.shake > 0 ? Math.sin(g.now * 60 + c) * 6 * u : 0;
        const x = c * colW + shake;
        if (b.broken) {
          ctx.fillStyle = 'rgba(10,6,3,0.85)'; // the hole
          ctx.fillRect(c * colW, y, colW, rowH);
          continue;
        }
        ctx.fillStyle = row.layer.fill;
        ctx.fillRect(x + 3 * u, y + 3 * u, colW - 6 * u, rowH - 6 * u);
        ctx.fillStyle = row.layer.top;
        ctx.fillRect(x + 3 * u, y + 3 * u, colW - 6 * u, 18 * u);
        ctx.strokeStyle = row.layer.dark;
        ctx.lineWidth = 6 * u;
        ctx.strokeRect(x + 3 * u, y + 3 * u, colW - 6 * u, rowH - 6 * u);
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

    // The brick each kid will stomp, outlined in their colour.
    if (!this.drop) {
      for (const p of g.activePlayers()) {
        const k = this.kids.get(p.id);
        if (!k || k.col === undefined || this.rows[0].bricks[k.col].broken) continue;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 10 * u;
        ctx.strokeRect(k.col * colW + 8 * u, top + 8 * u, colW - 16 * u, rowH - 16 * u);
      }
    }

    // Depth meter down the left side.
    text(ctx, `${this.depth * 2} m`, 30 * u, g.H * 0.3, 64 * u, { align: 'left', color: '#ffe14d' });
    text(ctx, 'deep', 30 * u, g.H * 0.3 + 60 * u, 36 * u, { align: 'left' });
    const toChest = TREASURE_EVERY - 1 - (this.rows[0].depth % TREASURE_EVERY);
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
