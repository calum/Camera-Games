// TEMPLATE: copy this file to start a new level. It is a complete, working level ("Catch the stars": stars
// fall, touch them with a hand), but it is not in the game until you add it to the list in ./index.js.
// The full walk-through is docs/ADDING-GAMES.md. In short:
//   1. cp src/levels/_template.js src/levels/<your-id>.js, and change id / title / hint / color below
//   2. import it in src/levels/index.js and add it to LEVELS (the order there is the playing order)
//   3. node server.mjs, open http://localhost:8137/?mouse&level=<your-id>   (mouse = a pretend kid)
//   4. npm test && npm run typecheck   (every level in the list is checked and played automatically)
//
// Rules of thumb (CLAUDE.md has the why):
//   - read players with g.activePlayers() (kids who sat out are left out for you)
//   - sizes and speeds in u units: 60 * g.u, never 60
//   - be generous: kids are small and tracking is noisy, so hit boxes are bigger than they look
//   - nothing pops: fade things in and out, and never fail a kid for a single glitchy frame
/** @import { Level } from '../types.js' */
import { sfx } from '../audio.js';
import { drawArt } from '../art.js';
import { rand, handTouching, reachX } from './kit.js';

// Tuning constants live at the top so a playtest can adjust them without reading the code.
const SPAWN_EVERY = 0.9; // seconds between stars (shrinks with more kids and in harder rounds)
const FALL_SPEED = 260; // u per second

/** @satisfies {Level} */
const template = {
  id: 'stars', // unique, lowercase; also picks the backdrop (see `backdrop`) and assets/bg_<id>.png
  title: 'Catch the stars!',
  icon: '⭐', // the big picture on this level's card in the level picker
  hint: 'Touch the falling stars with your hands!',
  color: '#ffd24d',
  duration: 30, // seconds
  backdrop: 'menu', // reuse an existing scene: menu, bubbles, dodge, jump, dance, finale (or write your own Scene)
  art: { bigstar: { file: 'bigstar.png', emoji: '⭐' } }, // optional art slot: drop assets/bigstar.png to replace

  // Reset ALL level state here: the same object is reused every time the level is played.
  start() {
    this.stars = [];
    this.spawn = 0.5;
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.spawn -= dt;
    if (this.spawn <= 0) {
      this.spawn = SPAWN_EVERY / Math.sqrt(Math.max(1, players.length)) / g.diff;
      this.stars.push({ x: reachX(g, rand(0.1, 0.9)), y: -60 * u, r: 55 * u, vy: FALL_SPEED * u * g.diff });
    }
    for (const s of this.stars) {
      s.y += s.vy * dt;
      const p = handTouching(players, s.x, s.y, s.r, 30 * u);
      if (p) {
        s.dead = true;
        g.score(p, 1, s.x, s.y);
        g.burst(s.x, s.y, '#ffd24d', 16);
        sfx.star();
      }
    }
    this.stars = this.stars.filter((s) => !s.dead && s.y < g.H + s.r);
  },

  draw(g, ctx) {
    for (const s of this.stars) {
      if (drawArt(ctx, 'bigstar', s.x, s.y, s.r * 2)) continue; // your PNG or the emoji
      ctx.beginPath(); // last resort if neither loaded: a plain gold circle
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd24d';
      ctx.fill();
    }
  },
};

export default template;
