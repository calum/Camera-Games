// Level: Pop the bubbles. Bubbles float up; any hand pops them, gold ones are worth 3.
/** @import { Level } from '../types.js' */
import { sfx } from '../audio.js';
import { drawArt } from '../art.js';
import { text } from '../draw.js';
import { rand, handTouching } from './kit.js';

/** @satisfies {Level} */
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
      const p = handTouching(players, b.x, b.y, b.r, 30 * u);
      if (p) {
        b.dead = true;
        g.score(p, b.gold ? 3 : 1, b.x, b.y);
        g.burst(b.x, b.y, b.gold ? '#ffd24d' : '#bfeaff', b.gold ? 22 : 12);
        (b.gold ? sfx.gold : sfx.bubble)();
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

export default bubbles;
