// Hole in the wall! A wall rushes at the camera with a pose-shaped hole in it; strike the pose
// before it arrives or go BONK. Same poses as the dance level (p.pose.armsUp / airplane /
// handsHead) but with something coming at you. Same level contract as src/levels.js:
//   { id, title, hint, duration, start(g), update(g,dt), draw(g,ctx) }
// Nothing here can fail the level: a miss is a silly BONK, never a lost heart.
/** @import { Level } from '../types.js' */
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { sfx } from '../audio.js';
import { text, drawPoseIcon } from '../draw.js';

const WALL_TIME_START = 3.2; // seconds for the first wall to grow to full size
const WALL_TIME_STEP = 0.12; // each wall is this much quicker than the last...
const WALL_TIME_MIN = 2.2; // ...but never quicker than this (before g.diff)
const GAP = 1.0; // pause between one wall and the next
const FIRST_GAP = 1.2; // pause before the very first wall
const START_SCALE = 0.14; // wall size at the start, as a fraction of the screen
const FADE_IN = 0.3; // seconds the wall takes to fade in (nothing pops)
const FADE_OUT = 0.45; // seconds the wall takes to fade away after it arrives
const JUDGE_WINDOW = 0.8; // look back this far from arrival...
const JUDGE_NEED = 0.3; // ...and need this much pose time in it (tracking flickers)
const RING_FILL = 0.5; // seconds of holding the pose to fill the ring over the head
const FEEDBACK_TIME = 1.5; // seconds a WHOOSH / BONK message stays on screen
const SAFE_POINTS = 2;

export const POSES = [
  { key: 'armsUp', name: 'Arms up high!' },
  { key: 'airplane', name: 'Be an airplane!' },
  { key: 'handsHead', name: 'Hands on your head!' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Seconds the n-th wall (0-based) takes to arrive. Harder difficulty = quicker, with a floor.
export const wallTime = (n, diff = 1) => Math.max(WALL_TIME_MIN, (WALL_TIME_START - WALL_TIME_STEP * n) / diff);

// Never the same pose twice in a row.
export const nextPose = (prev) => pick(POSES.filter((p) => p !== prev));

// The judging rule: safe if the pose is right at the moment of arrival, or was held for at
// least JUDGE_NEED seconds in total during the JUDGE_WINDOW before it.
export const isSafe = (poseNow, heldInWindow) => !!poseNow || heldInWindow >= JUDGE_NEED;

// How big the wall is (fraction of the screen, START_SCALE..1) after prog = t / wallTime.
// Accelerating, so it feels like it is rushing at you.
export const wallScale = (prog) => START_SCALE + (1 - START_SCALE) * Math.min(1, Math.max(0, prog)) ** 2;

/** @satisfies {Level} */
const wall = {
  id: 'wall',
  backdrop: EXTRA_SCENES.wall,
  title: 'Hole in the wall!',
  hint: 'Copy the pose in the hole before the wall hits you!',
  color: '#ff9ad5',
  duration: 40,

  start() {
    this.phase = 'gap'; // 'gap' (waiting) | 'coming' (growing) | 'gone' (fading after arrival)
    this.timer = FIRST_GAP;
    this.n = 0; // walls started so far
    this.cur = null; // the pose of the current wall
    this.t = 0; // seconds since the current wall started
    this.time = WALL_TIME_START; // how long the current wall takes
    this.kids = new Map(); // player id -> { held (in judge window), ring }
    this.feedback = [];
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    for (const f of this.feedback) f.t += dt;
    this.feedback = this.feedback.filter((f) => f.t < FEEDBACK_TIME);

    if (this.phase === 'gap' || this.phase === 'gone') {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.phase === 'gone') {
        this.phase = 'gap';
        this.timer = GAP;
        return;
      }
      this.cur = nextPose(this.cur);
      this.time = wallTime(this.n++, g.diff);
      this.t = 0;
      this.kids.clear();
      this.phase = 'coming';
      sfx.whoosh();
    }

    this.t += dt;
    const inWindow = this.t >= this.time - JUDGE_WINDOW;
    for (const p of players) {
      let k = this.kids.get(p.id);
      if (!k) this.kids.set(p.id, (k = { held: 0, ring: 0 }));
      const on = !!p.pose[this.cur.key];
      if (inWindow && on) k.held += dt;
      k.ring = on ? Math.min(RING_FILL, k.ring + dt) : Math.max(0, k.ring - dt * 2);
    }
    if (this.t < this.time) return;

    // The wall has arrived: judge every active kid, once.
    for (const p of players) {
      const ok = isSafe(p.pose[this.cur.key], this.kids.get(p.id).held);
      const x = p.cx;
      this.feedback.push({
        x,
        y: Math.max(170 * u, p.px[0].y - 240 * u), // well above the head and the score badge
        t: 0,
        text: ok ? 'WHOOSH! ✓' : 'BONK!',
        color: ok ? '#4dff88' : '#ff6b6b',
      });
      p.flashUntil = g.now + 0.7; // the whole skeleton flashes green / red
      p.flashColor = ok ? '#4dff88' : '#ff5a5a';
      if (ok) {
        g.score(p, SAFE_POINTS, x, p.sh.y - 120 * u);
        g.burst(x, p.sh.y, '#4dff88', 18);
        sfx.star();
      } else {
        g.burst(x, p.sh.y, '#ffffff', 22); // foam
        sfx.splash();
      }
    }
    this.phase = 'gone';
    this.timer = FADE_OUT;
  },

  draw(g, ctx) {
    const u = g.u;
    const pulse = 1 + 0.05 * Math.sin(g.now * 8);

    if (this.phase !== 'gap' && this.cur) {
      const arrived = this.phase === 'gone';
      const s = arrived ? 1 : wallScale(this.t / this.time);
      const alpha = arrived ? Math.max(0, this.timer / FADE_OUT) : Math.min(1, this.t / FADE_IN);
      const w = g.W * s;
      const h = g.H * s;
      const cx = g.W / 2;
      const cy = g.H / 2;
      ctx.save();
      // see-through as it gets close, so the kids can still see themselves while they pose
      ctx.globalAlpha = alpha * (0.92 - 0.45 * s);
      // the wall: a big coloured slab with brick lines that grow with it
      ctx.fillStyle = '#ff9ad5';
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeStyle = 'rgba(160,40,110,0.35)';
      ctx.lineWidth = Math.max(1, 5 * u * s);
      const rows = 6;
      for (let r = 1; r < rows; r++) {
        const y = cy - h / 2 + (h * r) / rows;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, y);
        ctx.lineTo(cx + w / 2, y);
        ctx.stroke();
        for (let c = (r % 2) * 0.5 + 0.5; c < 8; c++) {
          ctx.beginPath();
          ctx.moveTo(cx - w / 2 + (w * c) / 8, y);
          ctx.lineTo(cx - w / 2 + (w * c) / 8, y + h / rows);
          ctx.stroke();
        }
      }
      ctx.lineWidth = Math.max(2, 14 * u * s);
      ctx.strokeStyle = '#c2347f';
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      // the hole: a darker panel with the bright pose in it, so it reads as a cut-out
      const hw = w * 0.5;
      const hh = h * 0.72;
      ctx.fillStyle = 'rgba(40,10,40,0.55)';
      ctx.fillRect(cx - hw / 2, cy - hh / 2, hw, hh);
      ctx.lineWidth = Math.max(2, 8 * u * s);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(cx - hw / 2, cy - hh / 2, hw, hh);
      drawPoseIcon(ctx, this.cur.key, cx, cy + hh * 0.18, Math.min(hh * 0.7, hw * 0.9), '#fff');
      ctx.restore();
      // the pose name makes way for the WHOOSH / BONK messages once the wall has arrived
      if (!arrived) text(ctx, this.cur.name, g.W / 2, 150 * u, 100 * u * pulse, { color: '#fff' });
    }

    // progress ring over each kid's head: fills while they hold the right pose
    if (this.phase === 'coming') {
      for (const p of g.activePlayers()) {
        const k = this.kids.get(p.id);
        if (!k) continue;
        const x = p.px[0].x;
        const y = p.px[0].y - Math.max(130 * u, p.shoulderW * 1.1);
        const full = k.ring >= RING_FILL;
        ctx.lineWidth = 12 * u;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 34 * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = full ? '#7dff6b' : p.color;
        ctx.beginPath();
        ctx.arc(x, y, 34 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (k.ring / RING_FILL));
        ctx.stroke();
        if (full) text(ctx, '✓', x, y, 46 * u, { color: '#7dff6b' });
      }
    }

    // Result of each kid's wall: big floating message over them.
    for (const f of this.feedback) {
      const a = f.t / FEEDBACK_TIME;
      const alpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      const pop = 1 + 0.5 * Math.max(0, 1 - f.t * 5);
      const x = Math.min(g.W - 260 * u, Math.max(260 * u, f.x));
      ctx.save();
      ctx.globalAlpha = alpha;
      text(ctx, f.text, x, f.y - 70 * u * a, 96 * u * pop, { color: f.color });
      ctx.restore();
    }
  },
};

export default wall;
