// Level: Dance party. Copy the pose on screen and hold it; each kid scores separately.
/** @import { Level } from '../types.js' */
import { sfx } from '../audio.js';
import { text, drawPoseIcon } from '../draw.js';
import { pick } from './kit.js';

const POSES = [
  { key: 'armsUp', name: 'Arms up high!' },
  { key: 'airplane', name: 'Be an airplane!' },
  { key: 'handsHead', name: 'Hands on your head!' },
];
const ROUND = 6;
const HOLD = 0.8; // seconds to hold a pose (shorter when the game has eased off, see ease.js)
const holdTime = (g) => HOLD * (g.ease ?? 1);

/** @satisfies {Level} */
const dance = {
  id: 'dance',
  title: 'Dance party!',
  icon: '🕺',
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
    sfx.chime();
  },

  update(g, dt) {
    this.roundT += dt;
    if (this.roundT >= ROUND) this.next(g);
    for (const p of g.activePlayers()) {
      if (p.pose[this.cur.key]) {
        p.hold = (p.hold || 0) + dt;
        if (p.hold >= holdTime(g) && !p.got) {
          p.got = true;
          g.score(p, 3, p.cx, p.sh.y - 120 * g.u);
          g.burst(p.cx, p.sh.y, p.color, 20);
          sfx.sparkle();
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
      ctx.arc(x, y, 34 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (p.hold || 0) / holdTime(g)));
      ctx.stroke();
      if (p.got) text(ctx, '✓', x, y, 46 * u, { color: '#7dff6b' });
    }
  },
};

export default dance;
