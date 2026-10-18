// Level: Dodge the rocks. A "!" warns where a rock will fall; the team shares 5 hearts and 0 hearts replays it.
/** @import { Level } from '../types.js' */
import { sfx } from '../audio.js';
import { drawArt } from '../art.js';
import { text } from '../draw.js';
import { rand, pick, bodyHit, loseHeart } from './kit.js';

/** @satisfies {Level} */
const dodge = {
  id: 'dodge',
  title: 'Dodge the rocks!',
  icon: '🪨',
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
        if (r.warn <= 0) sfx.whistle();
        continue;
      }
      r.y += r.vy * dt;
      r.rot += r.spin * dt;
      if (this.invul <= 0) {
        const p = bodyHit(players, r.x, r.y, r.r);
        if (p) {
          r.dead = true;
          this.invul = 1;
          loseHeart(g, p, r.x, r.y);
        }
      }
      if (!r.dead && r.y > g.H + r.r) {
        r.dead = true;
        g.score(null, 1, r.x, g.H - 120 * u);
        sfx.thud();
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

export default dodge;
