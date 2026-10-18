// Keep it up! Balloons float down slowly; bat them back up with your hands (or your head) and
// don't let any touch the floor. A new balloon joins every so often. Same level contract as
// src/levels.js: { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
// A balloon that lands just pops and comes back later: nobody loses, the "in the air" timer resets.
/** @import { Level } from '../types.js' */
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { sfx } from '../audio.js';
import { text } from '../draw.js';

const GRAVITY = 170; // u/s^2: floaty, so little arms have time
const MAX_FALL = 240; // u/s: air drag caps the fall speed
const BOUNCE = 640; // u/s upward after a tap
const SIDEWAYS = 260; // u/s sideways push, by where on the balloon you hit it
const HAND_PUSH = 0.25; // share of the hand's own speed passed on to the balloon
const HIT_SLACK = 30; // u: hands reach this far outside the balloon, like bubbles
const TAP_COOLDOWN = 0.3; // s: a hand resting in a balloon is one tap, not one per frame
const BALLOON_R = [70, 85]; // u
const FIRST = 1; // balloons at the start...
const EVERY = 7; // ...one more every 7 s...
const MAX_PER_KID = 2; // ...up to 2 per kid (and at least 3)
const RESPAWN = 2.5; // s before a popped balloon comes back
const FLOOR = 40; // u above the bottom of the screen counts as the floor
const STREAK_POINTS = 5; // every 5 s with no balloon dropped = +1 team point
const COLORS = ['#ff5a7a', '#4db8ff', '#ffd24d', '#6fe06f', '#b36bff', '#ff9a3d'];

const rand = (a, b) => a + Math.random() * (b - a);

// How many balloons should be up after `elapsed` seconds with `kids` players.
export const balloonTarget = (elapsed, kids) =>
  Math.min(Math.max(3, MAX_PER_KID * Math.max(1, kids)), FIRST + Math.floor(elapsed / EVERY));

// New velocity after a tap at point (hx, hy) moving at (hvx, hvy). Always upward, pushed
// sideways away from where it was hit, plus a bit of the hand's own swing.
export function tap(b, hx, hvx, u) {
  const off = Math.max(-1, Math.min(1, (b.x - hx) / b.r));
  return { vx: off * SIDEWAYS * u + hvx * HAND_PUSH, vy: -BOUNCE * u };
}

/** @satisfies {Level} */
const balloons = {
  id: 'balloons',
  backdrop: EXTRA_SCENES.balloons,
  title: 'Keep it up!',
  hint: "Tap the balloons up with your hands. Don't let them touch the floor!",
  color: '#ff5a7a',
  duration: 45,

  start(g) {
    this.items = [];
    this.elapsed = 0;
    this.respawns = []; // times when a popped balloon may come back
    this.air = 0; // seconds since a balloon last touched the floor
    this.best = 0;
    this.prevHands = new Map(); // player id -> last frame's hands, for hand speed
    this.made = 0;
    this.add(g);
  },

  add(g) {
    const u = g.u;
    const r = rand(BALLOON_R[0], BALLOON_R[1]) * u;
    this.items.push({
      x: rand(0.15, 0.85) * g.W,
      y: -r,
      vx: rand(-40, 40) * u,
      vy: 60 * u,
      r,
      color: COLORS[this.made++ % COLORS.length],
      cool: 0,
      wob: rand(0, 6.28),
    });
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.elapsed += dt;

    // More balloons over time (popped ones come back after a short wait).
    const want = balloonTarget(this.elapsed, players.length);
    const waiting = this.respawns.filter((t) => t > this.elapsed).length;
    this.respawns = this.respawns.filter((t) => t > this.elapsed);
    if (this.items.length + waiting < want) this.add(g);

    // Hand speeds from last frame, so a big swing sends a balloon further.
    const hands = [];
    for (const p of players) {
      const prev = this.prevHands.get(p.id);
      p.hands.forEach((h, i) => {
        const q = prev?.[i];
        hands.push({ p, x: h.x, y: h.y, vx: q && dt > 0 ? (h.x - q.x) / dt : 0 });
      });
      // the head can bounce one too
      if (p.px?.[0]) hands.push({ p, x: p.px[0].x, y: p.px[0].y, vx: 0, head: true });
      this.prevHands.set(p.id, p.hands.map((h) => ({ x: h.x, y: h.y })));
    }

    for (const b of this.items) {
      b.cool -= dt;
      const ease = g.ease ?? 1; // auto-ease (ease.js): floatier when balloons keep landing
      b.vy = Math.min(MAX_FALL * u * ease, b.vy + GRAVITY * u * ease * dt);
      b.vx *= Math.pow(0.6, dt); // air slows the sideways drift
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // bounce off the sides and the top, so balloons stay in play
      if (b.x < b.r) {
        b.x = b.r;
        b.vx = Math.abs(b.vx);
      } else if (b.x > g.W - b.r) {
        b.x = g.W - b.r;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < b.r && b.vy < 0) {
        b.y = b.r;
        b.vy = 0;
      }
      if (b.cool <= 0) {
        for (const h of hands) {
          if (Math.hypot(h.x - b.x, h.y - b.y) < b.r + HIT_SLACK * u) {
            const v = tap(b, h.x, h.vx, u);
            b.vx = v.vx;
            b.vy = v.vy;
            b.cool = TAP_COOLDOWN;
            g.score(h.p, 1, b.x, b.y - b.r);
            g.burst(b.x, b.y, b.color, 8);
            sfx.boop();
            break;
          }
        }
      }
      if (b.y + b.r >= g.H - FLOOR * u) {
        b.dead = true;
        g.burst(b.x, g.H - FLOOR * u, b.color, 22);
        sfx.pop();
        g.miss();
        this.respawns.push(this.elapsed + RESPAWN);
        this.air = 0;
      }
    }
    this.items = this.items.filter((b) => !b.dead);

    // Team bonus for keeping everything up.
    const before = this.air;
    this.air += dt;
    this.best = Math.max(this.best, this.air);
    if (Math.floor(this.air / STREAK_POINTS) > Math.floor(before / STREAK_POINTS)) {
      g.score(null, 1, g.W / 2, 240 * u);
      sfx.star();
    }
  },

  draw(g, ctx) {
    const u = g.u;
    for (const b of this.items) {
      const sway = Math.sin(g.now * 2 + b.wob) * 0.08;
      // string
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.r * 1.15);
      ctx.quadraticCurveTo(b.x + Math.sin(g.now * 3 + b.wob) * 20 * u, b.y + b.r * 1.6, b.x, b.y + b.r * 2.1);
      ctx.stroke();
      // balloon: slightly tall oval, a knot and a shine
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(sway);
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r * 0.92, b.r * 1.08, 0, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.lineWidth = 4 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-b.r * 0.12, b.r * 1.06);
      ctx.lineTo(b.r * 0.12, b.r * 1.06);
      ctx.lineTo(0, b.r * 1.2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-b.r * 0.35, -b.r * 0.45, b.r * 0.16, b.r * 0.28, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.restore();
      // warning glow when it's getting close to the floor
      const near = (b.y + b.r) / (g.H - FLOOR * u);
      if (near > 0.75 && b.vy > 0) {
        ctx.globalAlpha = Math.min(1, (near - 0.75) * 4);
        text(ctx, '!', b.x, b.y, b.r * 0.9, { color: '#fff' });
        ctx.globalAlpha = 1;
      }
    }
    // keep-up timer
    text(ctx, `${Math.floor(this.air)} s`, 30 * u, g.H * 0.3, 64 * u, { align: 'left', color: '#ffe14d' });
    text(ctx, 'in the air', 30 * u, g.H * 0.3 + 60 * u, 36 * u, { align: 'left' });
    if (this.best >= 5) text(ctx, `best ${Math.floor(this.best)} s`, 30 * u, g.H * 0.3 + 110 * u, 36 * u, { align: 'left' });
  },
};

export default balloons;
