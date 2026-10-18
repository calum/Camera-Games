// Catch the stars! A night-sky mix of Bubbles and Dodge. Same level contract as src/levels.js:
//   { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
// Stars drift down and are caught with a hand (like bubbles). Meteors get a "!" warning
// column and then fall like rocks in Dodge: only the body can be hit, hands are ignored.
/** @import { Level } from '../types.js' */
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { rand, handTouching, bodyHit, loseHeart } from './kit.js';

export const DURATION = 40;
export const GOLD_EVERY = 8; // every 8th star is a big golden shooting star
export const GOLD_POINTS = 3;
export const METEOR_SHARE = [0.2, 0.35]; // chance an item is a meteor: start and end of the level
const STAR_R = /** @type {[number, number]} */ ([55, 80]); // stars are big, toddlers have to hit them (u)
const STAR_VY = /** @type {[number, number]} */ ([90, 160]); // gentle fall speed (u/s), well below the meteors
const GOLD_VY = /** @type {[number, number]} */ ([180, 240]); // golden stars fall a bit faster
const GOLD_R_BONUS = 1.15;
const METEOR_R = /** @type {[number, number]} */ ([45, 65]);
const METEOR_VY = /** @type {[number, number]} */ ([400, 520]); // slowed like the rocks: kids found fast ones too hard
const WARN_TIME = 0.9; // seconds the red "!" column shows before the meteor falls
const CATCH_SLACK = 30; // hands catch a star this far outside its edge, like bubbles (u)
const INVUL_TIME = 1; // shared seconds without damage after a hit
const AIM_CHANCE = 0.5; // share of meteors aimed at a kid so standing still isn't a plan
const TAIL_LEN = 3.2; // meteor tail length, in meteor radii
const MIN_GAP = 0.3; // fastest spawn interval (s)

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Chance that a new item is a meteor, rising linearly over the level and capped at the end value.
export function meteorShare(elapsed, duration = DURATION) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return METEOR_SHARE[0] + (METEOR_SHARE[1] - METEOR_SHARE[0]) * t;
}

// Seconds until the next item: more kids and a higher difficulty mean more items.
export function spawnGap(players, diff = 1) {
  return Math.max(MIN_GAP, 0.8 / Math.sqrt(Math.max(1, players)) / diff);
}

// Is the n-th star (1-based) a golden one?
export const isGoldStar = (n) => n > 0 && n % GOLD_EVERY === 0;

// A 5-point star path centred on (x, y) with outer radius r.
export function starPath(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** @satisfies {Level} */
const meteor = {
  id: 'meteor',
  backdrop: EXTRA_SCENES.meteor,
  title: 'Catch the stars!',
  icon: '⭐',
  hint: 'Touch the stars with your hands. Gold ones are worth 3! Dodge the meteors when you see the !',
  color: '#ffd24d',
  duration: DURATION,
  hearts: true,

  start(g) {
    this.items = [];
    this.spawn = 0.6;
    this.elapsed = 0;
    this.invul = 0;
    this.stars = 0; // stars spawned so far, to find every 8th
    g.team.hearts = g.team.maxHearts;
  },

  spawnItem(g, players) {
    const u = g.u;
    if (Math.random() < meteorShare(this.elapsed, this.duration)) {
      const target = players.length && Math.random() < AIM_CHANCE ? pick(players).cx : rand(0.06, 0.94) * g.W;
      this.items.push({
        kind: 'meteor',
        x: Math.min(g.W * 0.97, Math.max(g.W * 0.03, target + rand(-60, 60) * u)),
        y: -120 * u,
        r: rand(...METEOR_R) * u,
        vy: rand(...METEOR_VY) * u * g.diff,
        warn: WARN_TIME,
      });
      return;
    }
    this.stars++;
    const gold = isGoldStar(this.stars);
    const r = rand(...STAR_R) * u * (gold ? GOLD_R_BONUS : 1);
    this.items.push({
      kind: gold ? 'gold' : 'star',
      x0: rand(0.08, 0.92) * g.W,
      x: 0,
      y: -r,
      r,
      vy: rand(...(gold ? GOLD_VY : STAR_VY)) * u * g.diff,
      amp: rand(10, 35) * u,
      f: rand(1, 2.2),
      ph: rand(0, 6.28),
      rot: rand(-0.3, 0.3),
    });
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.elapsed += dt;
    this.invul -= dt;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      this.spawn = spawnGap(players.length, g.diff);
      this.spawnItem(g, players);
    }

    for (const it of this.items) {
      if (it.kind === 'meteor') this.updateMeteor(g, it, dt, players);
      else this.updateStar(g, it, dt, players);
    }
    this.items = this.items.filter((it) => !it.dead);
  },

  updateStar(g, s, dt, players) {
    const u = g.u;
    s.y += s.vy * dt;
    s.x = s.x0 + Math.sin(g.now * s.f + s.ph) * s.amp;
    const p = handTouching(players, s.x, s.y, s.r, CATCH_SLACK * u);
    if (p) {
      s.dead = true;
      const gold = s.kind === 'gold';
      g.score(p, gold ? GOLD_POINTS : 1, s.x, s.y);
      g.burst(s.x, s.y, gold ? '#ffd24d' : '#fff6b0', gold ? 24 : 12);
      (gold ? sfx.gold : sfx.twinkle)();
      return;
    }
    if (s.y > g.H + s.r * 2) s.dead = true; // missed stars just drift away
  },

  updateMeteor(g, m, dt, players) {
    if (m.warn > 0) {
      m.warn -= dt;
      if (m.warn <= 0) sfx.whistle();
      return; // a warning can't hurt
    }
    m.y += m.vy * dt;
    // Only body circles count (at 80%, like the rocks); hands touching a meteor do nothing.
    const hit = this.invul <= 0 && bodyHit(players, m.x, m.y, m.r);
    if (hit) {
      m.dead = true;
      this.invul = INVUL_TIME;
      loseHeart(g, hit, m.x, m.y);
      return;
    }
    if (m.y > g.H + m.r) {
      m.dead = true;
      g.score(null, 1, m.x, g.H - 120 * g.u);
      sfx.thud();
    }
  },

  draw(g, ctx) {
    const u = g.u;
    for (const it of this.items) {
      if (it.kind === 'meteor') {
        if (it.warn > 0) {
          const pulse = 0.6 + 0.4 * Math.sin(g.now * 20);
          ctx.fillStyle = `rgba(255,70,50,${0.25 * pulse})`;
          ctx.fillRect(it.x - it.r, 0, it.r * 2, g.H);
          text(ctx, '!', it.x, 90 * u, 130 * u * pulse, { color: '#ffdd33' });
          continue;
        }
        // short flaming tail above, then the rock
        const tail = it.r * TAIL_LEN;
        ctx.fillStyle = 'rgba(255,90,30,0.55)';
        ctx.beginPath();
        ctx.moveTo(it.x - it.r, it.y);
        ctx.lineTo(it.x, it.y - tail);
        ctx.lineTo(it.x + it.r, it.y);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,200,60,0.7)';
        ctx.beginPath();
        ctx.moveTo(it.x - it.r * 0.55, it.y);
        ctx.lineTo(it.x, it.y - tail * 0.6);
        ctx.lineTo(it.x + it.r * 0.55, it.y);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.fillStyle = '#c8452a';
        ctx.fill();
        ctx.lineWidth = 4 * u;
        ctx.strokeStyle = '#ffb347';
        ctx.stroke();
        continue;
      }
      const gold = it.kind === 'gold';
      const twinkle = 1 + 0.08 * Math.sin(g.now * 8 + it.ph);
      starPath(ctx, it.x, it.y, it.r * twinkle, it.rot + Math.sin(g.now * 2 + it.ph) * 0.15);
      ctx.fillStyle = gold ? '#ffc21a' : '#fff3a0';
      ctx.fill();
      ctx.lineWidth = 4 * u;
      ctx.strokeStyle = gold ? '#fff' : '#ffe14d';
      ctx.stroke();
      if (gold) text(ctx, '3', it.x, it.y + it.r * 0.1, it.r * 0.9, { color: '#7a4a00' });
    }
  },
};

export default meteor;
