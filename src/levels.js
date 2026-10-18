// Each level is a small self-contained object:
//   start(g)        reset state
//   update(g, dt)   advance the game, read g.activePlayers()
//   draw(g, ctx)    paint the level (players are drawn on top by main.js)
// `g` is the shared game object from main.js (sizes are in "u" units: 1u = H/1080 px).
import { sfx } from './audio.js';
import { drawArt } from './art.js';
import { text, drawPoseIcon } from './draw.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- 1. Bubbles
const bubbles = {
  id: 'bubbles',
  title: 'Pop the bubbles!',
  hint: 'Wave your hands to pop them. Gold ones are worth 3!',
  color: '#2bb8ff',
  duration: 30,

  start() {
    this.items = [];
    this.spawn = 0.5;
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.spawn -= dt;
    if (this.spawn <= 0) {
      this.spawn = Math.max(0.35, 0.85 / Math.sqrt(Math.max(1, players.length)) / g.diff);
      const r = rand(55, 90) * u;
      this.items.push({
        x0: rand(0.08, 0.92) * g.W,
        x: 0,
        y: g.H + r,
        r,
        vy: rand(130, 220) * u * g.diff,
        amp: rand(10, 40) * u,
        f: rand(1, 2.5),
        ph: rand(0, 6.28),
        gold: Math.random() < 0.12,
      });
    }
    for (const b of this.items) {
      b.y -= b.vy * dt;
      b.x = b.x0 + Math.sin(g.now * b.f + b.ph) * b.amp;
    }
    for (const b of this.items) {
      for (const p of players) {
        if (b.dead) break;
        if (p.hands.some((h) => Math.hypot(h.x - b.x, h.y - b.y) < b.r + 30 * u)) {
          b.dead = true;
          g.score(p, b.gold ? 3 : 1, b.x, b.y);
          g.burst(b.x, b.y, b.gold ? '#ffd24d' : '#bfeaff', b.gold ? 22 : 12);
          (b.gold ? sfx.gold : sfx.pop)();
        }
      }
    }
    this.items = this.items.filter((b) => !b.dead && b.y > -b.r * 2);
  },

  draw(g, ctx) {
    for (const b of this.items) {
      if (drawArt(ctx, b.gold ? 'goldbubble' : 'bubble', b.x, b.y, b.r * 2)) continue;
      const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
      grad.addColorStop(0, b.gold ? 'rgba(255,248,200,0.95)' : 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.6, b.gold ? 'rgba(255,210,77,0.55)' : 'rgba(120,210,255,0.35)');
      grad.addColorStop(1, b.gold ? 'rgba(255,170,0,0.8)' : 'rgba(80,170,255,0.7)');
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 3 * g.u;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      if (b.gold) text(ctx, '3', b.x, b.y, b.r * 0.9, { color: '#fff' });
    }
  },
};

// ---------------------------------------------------------------- 2. Dodge
const dodge = {
  id: 'dodge',
  title: 'Dodge the rocks!',
  hint: 'Watch for the ! then move out of the way. You share 5 hearts!',
  color: '#ff7a3d',
  duration: 30,
  hearts: true,

  start(g) {
    this.rocks = [];
    this.spawn = 1.2;
    this.elapsed = 0;
    this.invul = 0;
    g.team.hearts = g.team.maxHearts;
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.elapsed += dt;
    this.invul -= dt;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const n = Math.max(1, players.length);
      this.spawn = Math.max(0.45, (1.35 - 0.015 * this.elapsed) / (1 + 0.35 * (n - 1)) / g.diff);
      // Half the rocks are aimed at a kid so standing still isn't a winning plan.
      const target = players.length && Math.random() < 0.5 ? pick(players).cx : rand(0.06, 0.94) * g.W;
      this.rocks.push({
        x: Math.min(g.W * 0.97, Math.max(g.W * 0.03, target + rand(-60, 60) * u)),
        y: -120 * u,
        r: rand(45, 70) * u,
        vy: rand(420, 560) * u * g.diff, // slowed down: kids found the first version too fast
        warn: 0.9,
        rot: rand(0, 6.28),
        spin: rand(-4, 4),
      });
    }
    for (const r of this.rocks) {
      if (r.warn > 0) {
        r.warn -= dt;
        if (r.warn <= 0) sfx.whoosh();
        continue;
      }
      r.y += r.vy * dt;
      r.rot += r.spin * dt;
      if (this.invul <= 0) {
        for (const p of players) {
          if (p.circles.some((c) => Math.hypot(c.x - r.x, c.y - r.y) < r.r + c.r * 0.8)) {
            r.dead = true;
            this.invul = 1;
            p.hitUntil = g.now + 0.8;
            g.team.hearts--;
            g.burst(r.x, r.y, '#ff5a3a', 24);
            sfx.boom();
            if (g.team.hearts <= 0) g.endLevel('Oh no, out of hearts! Try again!');
            break;
          }
        }
      }
      if (!r.dead && r.y > g.H + r.r) {
        r.dead = true;
        g.score(null, 1, r.x, g.H - 120 * u);
        sfx.tick();
      }
    }
    this.rocks = this.rocks.filter((r) => !r.dead);
  },

  draw(g, ctx) {
    const u = g.u;
    for (const r of this.rocks) {
      if (r.warn > 0) {
        const pulse = 0.6 + 0.4 * Math.sin(g.now * 20);
        ctx.fillStyle = `rgba(255,70,50,${0.25 * pulse})`;
        ctx.fillRect(r.x - r.r, 0, r.r * 2, g.H);
        text(ctx, '!', r.x, 90 * u, 130 * u * pulse, { color: '#ffdd33' });
        continue;
      }
      if (!drawArt(ctx, 'rock', r.x, r.y, r.r * 2.2, r.rot)) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.fillStyle = '#8a7f78';
        ctx.fill();
      }
    }
  },
};

// ---------------------------------------------------------------- 3. Jump
const WAVE_TIME = 1.6; // seconds for the wave to cross the screen
const COUNTDOWN = 1.8;
const FEEDBACK_TIME = 1.7; // seconds a jump result stays on screen

const jump = {
  id: 'jump',
  title: 'Jump the waves!',
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
      for (const mark of [-1.2, -0.6, 0]) if (before < mark && w.t >= mark) (mark === 0 ? sfx.go : sfx.tick)();
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
          sfx.star();
        } else {
          g.burst(p.hip.x, g.H - 120 * u, '#7fd0ff', 16);
          sfx.splash();
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

// ---------------------------------------------------------------- 4. Dance
const POSES = [
  { key: 'armsUp', name: 'Arms up high!' },
  { key: 'airplane', name: 'Be an airplane!' },
  { key: 'handsHead', name: 'Hands on your head!' },
];
const ROUND = 6;
const HOLD = 0.8; // seconds to hold a pose

const dance = {
  id: 'dance',
  title: 'Dance party!',
  hint: 'Copy the pose on the screen and hold it!',
  color: '#c77dff',
  duration: ROUND * 5,

  start(g) {
    this.round = -1;
    this.roundT = ROUND; // forces the first round to start immediately
    this.cur = null;
    this.next(g);
  },

  next(g) {
    this.round++;
    this.roundT = 0;
    const choices = POSES.filter((p) => p !== this.cur);
    this.cur = pick(choices);
    for (const p of g.players) {
      p.hold = 0;
      p.got = false;
    }
    sfx.go();
  },

  update(g, dt) {
    this.roundT += dt;
    if (this.roundT >= ROUND) this.next(g);
    for (const p of g.activePlayers()) {
      if (p.pose[this.cur.key]) {
        p.hold = (p.hold || 0) + dt;
        if (p.hold >= HOLD && !p.got) {
          p.got = true;
          g.score(p, 3, p.cx, p.sh.y - 120 * g.u);
          g.burst(p.cx, p.sh.y, p.color, 20);
          sfx.star();
        }
      } else {
        p.hold = Math.max(0, (p.hold || 0) - dt * 2);
      }
    }
  },

  draw(g, ctx) {
    const u = g.u;
    const pulse = 1 + 0.06 * Math.sin(g.now * 8);
    text(ctx, this.cur.name, g.W / 2, 170 * u, 90 * u * pulse, { color: '#fff' });
    // Icon sits at the right edge so it never covers the kids in the middle.
    drawPoseIcon(ctx, this.cur.key, g.W - 230 * u, g.H * 0.5, 340 * u * pulse, '#fff');
    // progress rings over each kid's head
    for (const p of g.activePlayers()) {
      const x = p.px[0].x;
      const y = p.px[0].y - Math.max(130 * u, p.shoulderW * 1.1);
      ctx.lineWidth = 12 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(x, y, 34 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = p.got ? '#7dff6b' : p.color;
      ctx.beginPath();
      ctx.arc(x, y, 34 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (p.hold || 0) / HOLD));
      ctx.stroke();
      if (p.got) text(ctx, '✓', x, y, 46 * u, { color: '#7dff6b' });
    }
  },
};

export const LEVELS = [bubbles, dodge, jump, dance];
