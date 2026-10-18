// Avalanche!: the sequel to Dodge. Same falling rocks and shared hearts, plus
//   - "PHEW!" near-miss stars when a rock whistles past a kid,
//   - rolling boulders you jump over (judged like the wave in the jump level),
//   - a giant boulder at the end: stand in the one safe gap (kind: never costs hearts).
// Same level contract as src/levels.js: { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
/** @import { Level } from '../types.js' */
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { sfx } from '../audio.js';
import { drawArt } from '../art.js';
import { text } from '../draw.js';

const DURATION = 45;
const WARN = 0.9; // seconds of red "!" column before a rock falls
const INVUL = 1; // seconds of shared invulnerability after a heart is lost
const NEAR_MISS_W = 0.6; // near miss = a rock passes within this many shoulder widths of the body
const NEAR_MISS_FALLBACK = 60; // ...or this many u when the shoulder width is unknown
const PHEW_TIME = 1; // seconds the floating "PHEW!" stays
const SHADOW_Y = 60; // shadows sit this many u above the bottom of the screen
const BOULDER_FIRST = 12; // seconds into the level when the first boulder is announced
const BOULDER_GAP = [6, 8]; // seconds between boulders
const BOULDER_COUNTDOWN = 1.8; // 3-2-1 before it starts rolling
const BOULDER_TIME = 2.2; // seconds for a boulder to cross the screen
const BOULDER_R = 85; // u
const JUMP_EARLY = 0.5; // forgiving jump window: 0.5 s early...
const JUMP_LATE = 0.3; // ...to 0.3 s late (same as the jump level)
const BIG_BEFORE_END = 8; // the giant boulder starts this long before the end
const BIG_WARN = 3; // seconds of warning
const BIG_FALL = 0.35; // seconds the boulder takes to drop
const BIG_AFTER = 1.6; // seconds of dust after the crash (still no new rocks)
const BIG_GAP = 0.25; // safe gap width as a fraction of the screen
const BIG_PTS = 3;
const FEEDBACK_TIME = 1.7;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// How far a rock's edge is from the nearest body circle (negative = touching, same 0.8 rule as a hit).
export function rockGap(rock, circles) {
  let best = Infinity;
  for (const c of circles) best = Math.min(best, Math.hypot(c.x - rock.x, c.y - rock.y) - (rock.r + c.r * 0.8));
  return best;
}

// Near-miss distance for a kid: about one hand's width.
export const nearDistance = (p, u) => (p.shoulderW > 0 ? NEAR_MISS_W * p.shoulderW : NEAR_MISS_FALLBACK * u);

// Was the jump inside the forgiving window around the moment the boulder reached the kid?
export const jumpedInTime = (lastJump, cross) => lastJump > cross - JUMP_EARLY && lastJump <= cross + JUMP_LATE;

export const inGap = (cx, gapX, gapW) => Math.abs(cx - gapX) <= gapW / 2;

// Shadow growth 0..1 as a rock gets closer to the floor.
export const shadowGrow = (y, H) => clamp((y + 120) / (H + 120), 0, 1);

/** @satisfies {Level} */
const avalanche = {
  id: 'avalanche',
  backdrop: EXTRA_SCENES.avalanche,
  title: 'Avalanche!',
  hint: 'Dodge the rocks, jump the boulders, and hide in the gap at the end!',
  color: '#9ad0ff',
  duration: DURATION,
  hearts: true,

  start(g) {
    this.rocks = [];
    this.boulders = [];
    this.feedback = [];
    this.big = null;
    this.bigDone = false;
    this.spawn = 1.2;
    this.elapsed = 0;
    this.invul = 0;
    this.nextBoulder = BOULDER_FIRST;
    g.team.hearts = g.team.maxHearts;
  },

  loseHeart(g, x, y) {
    if (this.invul > 0) return false;
    this.invul = INVUL;
    g.team.hearts--;
    g.burst(x, y, '#ff5a3a', 24);
    sfx.boom();
    if (g.team.hearts <= 0) g.endLevel('Oh no, out of hearts! Try again!');
    return true;
  },

  say(p, g, str, color, o = {}) {
    const u = g.u;
    this.feedback.push({
      x: o.x ?? p.cx,
      y: o.y ?? Math.max(170 * u, (p.px?.[0]?.y ?? p.sh.y) - 200 * u),
      t: 0,
      life: o.life ?? FEEDBACK_TIME,
      text: str,
      sub: o.sub ?? '',
      color,
      size: o.size ?? 90,
    });
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.elapsed += dt;
    this.invul -= dt;
    this.spawn -= dt;

    // The big boulder starts BIG_BEFORE_END seconds before the end; nothing else is spawned then.
    if (!this.big && !this.bigDone && this.elapsed >= DURATION - BIG_BEFORE_END) {
      const w = g.W * BIG_GAP;
      this.big = { t: 0, gapW: w, gapX: rand(w / 2 + 0.04 * g.W, g.W - w / 2 - 0.04 * g.W), judged: false };
      sfx.whoosh();
    }
    const bigBusy = !!this.big;

    if (this.spawn <= 0 && !bigBusy) {
      const n = Math.max(1, players.length);
      this.spawn = Math.max(0.45, (1.35 - 0.015 * this.elapsed) / (1 + 0.35 * (n - 1)) / g.diff);
      // Half the rocks are aimed at a kid so standing still isn't a winning plan.
      const target = players.length && Math.random() < 0.5 ? pick(players).cx : rand(0.06, 0.94) * g.W;
      this.rocks.push({
        x: Math.min(g.W * 0.97, Math.max(g.W * 0.03, target + rand(-60, 60) * u)),
        y: -120 * u,
        r: rand(45, 70) * u,
        vy: rand(420, 560) * u * g.diff,
        warn: WARN,
        rot: rand(0, 6.28),
        spin: rand(-4, 4),
        track: new Map(), // kid id -> closest approach so far
        paid: new Set(), // kids who already got their PHEW for this rock
      });
    } else if (this.spawn <= 0) {
      this.spawn = 0.2; // keep the timer sane while the big one is on
    }

    // ---- rocks
    for (const r of this.rocks) {
      if (r.warn > 0) {
        r.warn -= dt;
        if (r.warn <= 0) sfx.whoosh();
        continue;
      }
      r.y += r.vy * dt;
      r.rot += r.spin * dt;
      for (const p of players) {
        const gap = rockGap(r, p.circles);
        r.track.set(p.id, Math.min(r.track.get(p.id) ?? Infinity, gap));
        // A rock that is now below the kid's lowest circle has passed them: pay out the near miss once.
        const low = Math.max(...p.circles.map((c) => c.y + c.r));
        if (!r.paid.has(p.id) && r.y - r.r > low) {
          r.paid.add(p.id);
          const m = r.track.get(p.id);
          if (m > 0 && m <= nearDistance(p, u)) {
            g.score(p, 1, p.cx, (p.px?.[0]?.y ?? p.sh.y) - 100 * u);
            sfx.star();
            this.say(p, g, 'PHEW! +1', '#ffe14d', { life: PHEW_TIME, size: 80 });
          }
        }
      }
      if (this.invul <= 0) {
        for (const p of players) {
          if (p.circles.some((c) => Math.hypot(c.x - r.x, c.y - r.y) < r.r + c.r * 0.8)) {
            r.dead = true;
            p.hitUntil = g.now + 0.8;
            this.loseHeart(g, r.x, r.y);
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

    // ---- rolling boulders
    if (this.elapsed >= this.nextBoulder) {
      this.nextBoulder = this.elapsed + rand(BOULDER_GAP[0], BOULDER_GAP[1]);
      // not too close to the giant boulder
      if (this.elapsed < DURATION - BIG_BEFORE_END - 4) {
        this.boulders.push({ dir: Math.random() < 0.5 ? 1 : -1, t: -BOULDER_COUNTDOWN, x: -999, rot: 0, judged: new Map() });
      }
    }
    for (const b of this.boulders) {
      const before = b.t;
      b.t += dt;
      for (const mark of [-1.2, -0.6, 0]) if (before < mark && b.t >= mark) (mark === 0 ? sfx.go : sfx.tick)();
      if (b.t < 0) continue;
      const prog = b.t / BOULDER_TIME;
      const span = g.W + 2 * BOULDER_R * u * 2;
      b.x = b.dir > 0 ? -2 * BOULDER_R * u + prog * span : g.W + 2 * BOULDER_R * u - prog * span;
      b.rot += b.dir * dt * 6;
      for (const p of players) {
        if (!b.judged.has(p.id) && Math.abs(p.hip.x - b.x) < 90 * u) b.judged.set(p.id, { cross: g.now, done: false });
      }
      for (const [id, j] of b.judged) {
        if (j.done || g.now < j.cross + JUMP_LATE) continue;
        j.done = true;
        const p = g.players.find((q) => q.id === id);
        if (!p) continue;
        const ok = jumpedInTime(p.lastJump, j.cross);
        p.flashUntil = g.now + 0.7;
        p.flashColor = ok ? '#4dff88' : '#ff5a5a';
        if (ok) {
          g.score(p, 1, p.hip.x, p.sh.y - 120 * u);
          g.burst(p.hip.x, g.H - 150 * u, '#4dff88', 18);
          sfx.star();
          this.say(p, g, '✓ NICE JUMP!', '#4dff88', { x: p.hip.x });
        } else {
          p.hitUntil = g.now + 0.8;
          this.loseHeart(g, p.hip.x, g.H - 120 * u);
          this.say(p, g, '✗ OUCH!', '#ff6b6b', { x: p.hip.x, sub: 'jump when it reaches you' });
        }
      }
    }
    this.boulders = this.boulders.filter((b) => b.t < BOULDER_TIME + 0.8);

    // ---- the giant boulder
    const big = this.big;
    if (big) {
      const before = big.t;
      big.t += dt;
      for (const mark of [BIG_WARN - 2, BIG_WARN - 1]) if (before < mark && big.t >= mark) sfx.tick();
      if (!big.judged && big.t >= BIG_WARN + BIG_FALL) {
        big.judged = true;
        sfx.boom();
        const safe = [];
        for (const p of players) {
          if (inGap(p.cx, big.gapX, big.gapW)) {
            safe.push(p);
            g.score(p, BIG_PTS, p.cx, p.sh.y - 120 * u);
            g.burst(p.cx, p.sh.y, '#4dff88', 18);
            p.flashUntil = g.now + 0.7;
            p.flashColor = '#4dff88';
            this.say(p, g, `SAFE! +${BIG_PTS}`, '#4dff88');
          } else {
            g.burst(p.cx, g.H - 120 * u, '#c9b8a8', 22);
            p.flashUntil = g.now + 0.7;
            p.flashColor = '#ff5a5a';
            this.say(p, g, 'SPLAT!', '#ff6b6b', { sub: 'get in the gap next time!' });
          }
        }
        if (players.length && safe.length === players.length) {
          sfx.fanfare();
          this.say({ cx: g.W / 2, px: [{ y: 520 * u }] }, g, 'EVERYONE MADE IT!', '#ffe14d', { size: 130, life: 2.2 });
        }
      }
      if (big.t >= BIG_WARN + BIG_FALL + BIG_AFTER) {
        this.big = null;
        this.bigDone = true;
      }
    }

    for (const f of this.feedback) f.t += dt;
    this.feedback = this.feedback.filter((f) => f.t < f.life);
  },

  draw(g, ctx) {
    const u = g.u;
    const floorY = g.H - SHADOW_Y * u;

    // ground shadows grow as a rock gets closer
    for (const r of this.rocks) {
      if (r.warn > 0) continue;
      const k = shadowGrow(r.y / u, g.H / u);
      const rx = r.r * (0.3 + 1.1 * k);
      ctx.beginPath();
      ctx.ellipse(r.x, floorY, rx, rx * 0.25, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.38 * k})`;
      ctx.fill();
    }

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

    // rolling boulders: 3-2-1 + arrow, then JUMP!
    for (const b of this.boulders) {
      if (b.t < 0) {
        const n = b.t < -1.2 ? '3' : b.t < -0.6 ? '2' : '1';
        text(ctx, `${n}  ${b.dir > 0 ? '→' : '←'}`, g.W / 2, g.H * 0.3, 220 * u, { color: '#fff' });
        continue;
      }
      if (b.t < 0.9) text(ctx, 'JUMP!', g.W / 2, g.H * 0.3, 200 * u, { color: '#ffe14d' });
      const R = BOULDER_R * u;
      const y = g.H - SHADOW_Y * u - R * 0.6;
      ctx.save();
      ctx.translate(b.x, y);
      ctx.rotate(b.rot);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = '#7a706a';
      ctx.fill();
      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = '#4d4642';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, 0);
      ctx.lineTo(R * 0.2, -R * 0.4);
      ctx.moveTo(R * 0.1, R * 0.5);
      ctx.lineTo(R * 0.6, R * 0.1);
      ctx.stroke();
      ctx.restore();
    }

    // the giant boulder: red zone everywhere except the green gap
    const big = this.big;
    if (big) {
      const left = big.gapX - big.gapW / 2;
      const right = big.gapX + big.gapW / 2;
      const fade = clamp(big.t / 0.5, 0, 1) * (big.t < BIG_WARN + BIG_FALL ? 1 : clamp(1 - (big.t - BIG_WARN - BIG_FALL) / BIG_AFTER, 0, 1));
      const pulse = 0.75 + 0.25 * Math.sin(g.now * 14);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = `rgba(255,50,40,${0.42 * pulse})`;
      ctx.fillRect(0, 0, left, g.H);
      ctx.fillRect(right, 0, g.W - right, g.H);
      ctx.fillStyle = 'rgba(77,255,136,0.28)';
      ctx.fillRect(left, 0, right - left, g.H);
      ctx.lineWidth = 8 * u;
      ctx.strokeStyle = '#4dff88';
      ctx.strokeRect(left, -10, right - left, g.H + 20);
      ctx.restore();
      if (big.t < BIG_WARN) {
        const n = Math.ceil(BIG_WARN - big.t);
        text(ctx, 'GET IN THE GAP!', g.W / 2, g.H * 0.2, 110 * u, { color: '#ffe14d' });
        text(ctx, String(n), big.gapX, g.H * 0.45, 200 * u, { color: '#4dff88' });
      } else {
        // the boulder drops over the red zones
        const k = clamp((big.t - BIG_WARN) / BIG_FALL, 0, 1);
        const a = clamp(1 - (big.t - BIG_WARN - BIG_FALL) / BIG_AFTER, 0, 1);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#6b625c';
        const y = -g.H * (1 - k);
        ctx.fillRect(0, y, left, g.H);
        ctx.fillRect(right, y, g.W - right, g.H);
        ctx.restore();
      }
    }

    // floating messages (PHEW!, NICE JUMP!, SAFE!, SPLAT!, EVERYONE MADE IT!)
    for (const f of this.feedback) {
      const a = f.t / f.life;
      const alpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      const pop = 1 + 0.5 * Math.max(0, 1 - f.t * 5);
      const x = clamp(f.x, 260 * u, g.W - 260 * u);
      ctx.save();
      ctx.globalAlpha = alpha;
      text(ctx, f.text, x, f.y - 60 * u * a, f.size * u * pop, { color: f.color });
      if (f.sub) text(ctx, f.sub, x, f.y - 60 * u * a + 70 * u, 40 * u, { color: '#fff' });
      ctx.restore();
    }
  },
};

export default avalanche;
