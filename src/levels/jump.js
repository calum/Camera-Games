// Level: Jump the waves. A 3-2-1 countdown, then a wave rolls across; jump as it reaches you.
/** @import { Level } from '../types.js' */
import { sfx } from '../audio.js';
import { text } from '../draw.js';

const WAVE_TIME = 1.6; // seconds for the wave to cross the screen
const COUNTDOWN = 1.8;
const FEEDBACK_TIME = 1.7; // seconds a jump result stays on screen

/** @satisfies {Level} */
const jump = {
  id: 'jump',
  title: 'Jump the waves!',
  icon: '🌊',
  hint: 'When the wave reaches you, JUMP!',
  color: '#2bd1a0',
  duration: 32,

  start() {
    this.waves = [];
    this.feedback = []; // big "NICE JUMP!" / "SPLASH!" messages floating over each kid
    this.next = 2;
    this.dir = 1;
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.next -= dt;
    if (this.next <= 0) {
      this.waves.push({ dir: this.dir, t: -COUNTDOWN, x: -999, judged: new Map(), tick: 4 });
      this.dir *= -1;
      this.next = 4.8 / Math.sqrt(g.diff);
    }
    for (const w of this.waves) {
      const before = w.t;
      w.t += dt;
      // countdown ticks at 3, 2, 1
      for (const mark of [-1.2, -0.6, 0]) if (before < mark && w.t >= mark) (mark === 0 ? sfx.wave : sfx.tick)();
      if (w.t < 0) continue;
      const prog = w.t / WAVE_TIME;
      w.x = w.dir > 0 ? -150 * u + prog * (g.W + 300 * u) : g.W + 150 * u - prog * (g.W + 300 * u);
      for (const p of players) {
        if (!w.judged.has(p.id) && Math.abs(p.hip.x - w.x) < 90 * u) w.judged.set(p.id, { cross: g.now, done: false });
      }
      for (const [id, j] of w.judged) {
        if (j.done || g.now < j.cross + 0.3) continue;
        j.done = true;
        const p = g.players.find((q) => q.id === id);
        if (!p) continue;
        // Forgiving window: tracking has a little lag, and little legs jump early.
        const ok = p.lastJump > j.cross - 0.5 && p.lastJump <= j.cross + 0.3;
        const early = !ok && p.lastJump > j.cross - 1.6 && p.lastJump <= j.cross - 0.5;
        this.feedback.push({
          x: p.hip.x,
          y: Math.max(170 * u, p.px[0].y - 240 * u), // well above the head and the score badge
          t: 0,
          ok,
          text: ok ? '✓ NICE JUMP!' : early ? '✗ TOO EARLY!' : '✗ SPLASH!',
          sub: ok ? '' : early ? 'wait for the wave' : 'jump when it reaches you',
          color: ok ? '#4dff88' : '#ff6b6b',
        });
        p.flashUntil = g.now + 0.7; // the whole skeleton flashes green / red
        p.flashColor = ok ? '#4dff88' : '#ff5a5a';
        if (ok) {
          g.score(p, 1, p.hip.x, p.sh.y - 120 * u);
          g.burst(p.hip.x, p.sh.y, '#4dff88', 18);
          g.burst(p.hip.x, g.H - 150 * u, '#ffd24d', 22);
          sfx.boing();
        } else {
          g.burst(p.hip.x, g.H - 120 * u, '#7fd0ff', 16);
          sfx.splosh();
          g.miss();
        }
      }
    }
    for (const f of this.feedback) f.t += dt;
    this.feedback = this.feedback.filter((f) => f.t < FEEDBACK_TIME);
    this.waves = this.waves.filter((w) => w.t < WAVE_TIME + 0.8);
  },

  draw(g, ctx) {
    const u = g.u;
    const base = g.H - 110 * u;
    const crests = this.waves.filter((w) => w.t >= 0);
    // sea: gentle swell everywhere + a big crest where each wave is
    ctx.beginPath();
    ctx.moveTo(0, g.H);
    for (let x = 0; x <= g.W + 20; x += 20) {
      let y = base + Math.sin(x * 0.012 + g.now * 2) * 8 * u;
      for (const w of crests) {
        const d = (x - w.x) / (170 * u);
        y -= 230 * u * Math.exp(-d * d);
      }
      ctx.lineTo(x, y);
    }
    ctx.lineTo(g.W, g.H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, base - 200 * u, 0, g.H);
    grad.addColorStop(0, 'rgba(170,235,255,0.9)');
    grad.addColorStop(1, 'rgba(20,120,220,0.9)');
    ctx.fillStyle = grad;
    ctx.fill();

    for (const w of this.waves) {
      if (w.t < 0) {
        const n = w.t < -1.2 ? '3' : w.t < -0.6 ? '2' : '1';
        const arrow = w.dir > 0 ? '→' : '←';
        text(ctx, `${n}  ${arrow}`, g.W / 2, g.H * 0.3, 220 * u, { color: '#fff' });
      } else if (w.t < 0.9) {
        text(ctx, 'JUMP!', g.W / 2, g.H * 0.3, 200 * u, { color: '#ffe14d' });
      }
    }

    // Result of each kid's jump: big floating message, expanding ring at their feet.
    for (const f of this.feedback) {
      const a = f.t / FEEDBACK_TIME;
      const alpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      const pop = 1 + 0.5 * Math.max(0, 1 - f.t * 5);
      const x = Math.min(g.W - 260 * u, Math.max(260 * u, f.x));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 14 * u * (1 - a * 0.6);
      ctx.strokeStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, g.H - 120 * u, (60 + 380 * a) * u, 0, Math.PI * 2);
      ctx.stroke();
      text(ctx, f.text, x, f.y - 70 * u * a, 96 * u * pop, { color: f.color });
      if (f.sub) text(ctx, f.sub, x, f.y - 70 * u * a + 70 * u, 40 * u, { color: '#fff' });
      ctx.restore();
    }
  },
};

export default jump;
