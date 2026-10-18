// Level: Duck and Jump. Logs roll along the floor (jump over them) and birds fly across at head height
// (duck under them). Each one gets a 3-2-1 countdown with a big picture of what's coming, like the waves.
// A miss is a BONK with a hint, never a lost heart.
/** @import { Level, Player } from '../types.js' */
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { pick } from './kit.js';

const CROSS_TIME = 1.8; // seconds for a log or bird to cross the screen
const COUNTDOWN = 1.8; // 3-2-1 before it sets off
const GAP = 3.8; // seconds between hazards (shorter in harder rounds)
const LOGS_FIRST = 2; // the first hazards are always logs, so kids learn one move at a time
const BIRD_SHARE = 0.45; // after that, the chance a hazard is a bird
const EARLY = 0.5; // forgiving window: the move counts from 0.5 s before it reaches you...
const LATE = 0.3; // ...to 0.3 s after
const REACH = 90; // u: how close it has to be to a kid to count as reaching them
const FEEDBACK_TIME = 1.7;

// Did the kid make the right move in time? `cross` is when the hazard reached them.
/** @param {'log' | 'bird'} kind @param {Player} p @param {number} cross */
export function dodged(kind, p, cross) {
  const t = kind === 'log' ? p.lastJump : p.lastDuck ?? -99;
  return t > cross - EARLY && t <= cross + LATE;
}

/** @satisfies {Level} */
const duckjump = {
  id: 'duckjump',
  title: 'Duck and jump!',
  hint: 'Jump over the logs. Duck under the birds!',
  color: '#8bd450',
  duration: 40,
  backdrop: 'jump', // the beach: driftwood logs and seagulls

  start() {
    this.items = [];
    this.feedback = [];
    this.next = 1.5;
    this.count = 0;
    this.dir = 1;
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.next -= dt;
    if (this.next <= 0) {
      const kind = this.count < LOGS_FIRST || Math.random() >= BIRD_SHARE ? 'log' : 'bird';
      this.items.push({ kind, dir: this.dir, t: -COUNTDOWN, x: -999, y: 0, judged: new Map() });
      this.count++;
      this.dir = pick([1, -1]);
      this.next = GAP / Math.sqrt(g.diff);
    }
    for (const h of this.items) {
      const before = h.t;
      h.t += dt;
      for (const mark of [-1.2, -0.6, 0]) if (before < mark && h.t >= mark) (mark === 0 ? sfx.go : sfx.tick)();
      if (h.t < 0) continue;
      if (before < 0) {
        // a bird flies at the kids' head height, picked once so it doesn't wobble with tracking
        const heads = players.map((p) => p.px[0].y);
        h.y = heads.length ? heads.reduce((a, b) => a + b, 0) / heads.length : g.H * 0.35;
      }
      const span = g.W + 300 * u;
      h.x = h.dir > 0 ? -150 * u + (h.t / CROSS_TIME) * span : g.W + 150 * u - (h.t / CROSS_TIME) * span;
      for (const p of players) {
        if (!h.judged.has(p.id) && Math.abs(p.cx - h.x) < REACH * u) h.judged.set(p.id, { cross: g.now, done: false });
      }
      for (const [id, j] of h.judged) {
        if (j.done || g.now < j.cross + LATE) continue;
        j.done = true;
        const p = g.players.find((q) => q.id === id);
        if (!p) continue;
        const ok = dodged(h.kind, p, j.cross);
        this.feedback.push({
          x: p.cx,
          y: Math.max(170 * u, p.px[0].y - 240 * u),
          t: 0,
          text: ok ? (h.kind === 'log' ? '✓ NICE JUMP!' : '✓ NICE DUCK!') : '✗ BONK!',
          sub: ok ? '' : h.kind === 'log' ? 'jump over the logs' : 'duck under the birds',
          color: ok ? '#4dff88' : '#ff6b6b',
        });
        p.flashUntil = g.now + 0.7;
        p.flashColor = ok ? '#4dff88' : '#ff5a5a';
        if (ok) {
          g.score(p, 1, p.cx, p.sh.y - 120 * u);
          g.burst(p.cx, p.sh.y, '#4dff88', 18);
          sfx.star();
        } else {
          g.burst(p.cx, h.kind === 'log' ? g.H - 130 * u : p.px[0].y, h.kind === 'log' ? '#a0703f' : '#ffffff', 14);
          sfx.splash();
        }
      }
    }
    for (const f of this.feedback) f.t += dt;
    this.feedback = this.feedback.filter((f) => f.t < FEEDBACK_TIME);
    this.items = this.items.filter((h) => h.t < CROSS_TIME + 0.8);
  },

  draw(g, ctx) {
    const u = g.u;
    for (const h of this.items) {
      if (h.t < 0) {
        // countdown with a big picture of what's coming and what to do
        const n = h.t < -1.2 ? '3' : h.t < -0.6 ? '2' : '1';
        text(ctx, `${n}  ${h.dir > 0 ? '→' : '←'}`, g.W / 2, g.H * 0.22, 180 * u, { color: '#fff' });
        text(ctx, h.kind === 'log' ? 'JUMP!' : 'DUCK!', g.W / 2, g.H * 0.36, 120 * u, { color: h.kind === 'log' ? '#ffe14d' : '#7fd0ff' });
        if (h.kind === 'log') drawLog(ctx, g.W / 2 + 330 * u, g.H * 0.22, 0.7 * u, g.now * 3);
        else drawBird(ctx, g.W / 2 + 330 * u, g.H * 0.22, 0.9 * u, h.dir, g.now);
        continue;
      }
      if (h.kind === 'log') drawLog(ctx, h.x, g.H - 130 * u, u, (h.x / (60 * u)) * h.dir);
      else drawBird(ctx, h.x, h.y, 1.3 * u, h.dir, g.now);
    }
    for (const f of this.feedback) {
      const a = f.t / FEEDBACK_TIME;
      const x = Math.min(g.W - 260 * u, Math.max(260 * u, f.x));
      ctx.save();
      ctx.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      text(ctx, f.text, x, f.y - 70 * u * a, 90 * u * (1 + 0.5 * Math.max(0, 1 - f.t * 5)), { color: f.color });
      if (f.sub) text(ctx, f.sub, x, f.y - 70 * u * a + 66 * u, 40 * u, { color: '#fff' });
      ctx.restore();
    }
  },
};

// A rolling log: a brown capsule with end rings, rotating as it rolls.
function drawLog(ctx, x, y, s, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#8a5a32';
  ctx.strokeStyle = '#5b3a22';
  ctx.lineWidth = 6 * s;
  ctx.beginPath();
  ctx.ellipse(0, 0, 150 * s, 55 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // bark lines turning with the roll
  for (let k = 0; k < 3; k++) {
    const yy = Math.sin(rot + k * 2.1) * 40 * s;
    ctx.beginPath();
    ctx.moveTo(-120 * s, yy);
    ctx.lineTo(120 * s, yy);
    ctx.stroke();
  }
  ctx.fillStyle = '#d8b07a';
  ctx.beginPath();
  ctx.ellipse(140 * s, 0, 18 * s, 50 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// A cartoon bird flapping as it flies in direction `dir` (1 = right).
function drawBird(ctx, x, y, s, dir, t) {
  const flap = Math.sin(t * 14) * 0.8;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * s, s);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#33415c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 70, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // wing
  ctx.moveTo(-20, -5);
  ctx.lineTo(10, -5);
  ctx.lineTo(-15, -5 - 70 * flap);
  ctx.closePath();
  ctx.fillStyle = '#dfe7f2';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffb030'; // beak
  ctx.beginPath();
  ctx.moveTo(66, -8);
  ctx.lineTo(100, 4);
  ctx.lineTo(66, 14);
  ctx.fill();
  ctx.fillStyle = '#1b2233'; // eye
  ctx.beginPath();
  ctx.arc(40, -12, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default duckjump;
