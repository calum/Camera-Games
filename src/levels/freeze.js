// Level: Freeze! Music plays: dance like mad (moving scores). The music stops and FREEZE!: stay still
// until it starts again. Kids who wobble crack their ice cube; kids who stay frozen get a bonus. Uses
// p.motion (shoulder widths per second). The thresholds are generous because tracking jitters, most of all
// on small kids: tune them at the playtest.
/** @import { Level, Player } from '../types.js' */
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { rand } from './kit.js';

const DANCE_TIME = [4, 7]; // seconds of music
const FREEZE_TIME = [2.5, 4]; // seconds of freeze
const GRACE = 0.6; // seconds after "FREEZE!" to come to a stop before wobbling counts
const MOVING = 1.5; // motion above this while the music plays counts as dancing
const WOBBLE = 1.2; // motion above this during a freeze counts as wobbling...
const WOBBLE_FOR = 0.4; // ...and this many seconds of wobbling cracks the ice
const DANCE_POINT = 1; // seconds of dancing per point
const FROZEN_POINTS = 3;
const BEAT = 0.4; // seconds per beat of the little tune
const FEEDBACK_TIME = 1.5;
const TUNE = [0, 2, 4, 2, 0, 4, 5, 4]; // played on sfx.tick / sfx.pop, just enough to hear the music stop

/** Is this kid dancing (music on) or wobbling (freeze on)? @param {Player} p @param {'dance'|'freeze'} phase */
export const isMoving = (p, phase) => (p.motion ?? 0) > (phase === 'dance' ? MOVING : WOBBLE);

/** @satisfies {Level} */
const freeze = {
  id: 'freeze',
  title: 'Freeze!',
  hint: 'Dance while the music plays. When it stops, FREEZE!',
  color: '#7fd0ff',
  duration: 40,
  backdrop: 'dance', // the disco

  start() {
    this.phase = 'dance';
    this.timer = rand(DANCE_TIME[0], DANCE_TIME[1]);
    this.t = 0; // seconds into the current phase
    this.beat = 0;
    this.kids = new Map(); // id -> { danced, wobble, cracked }
    this.feedback = [];
  },

  kid(p) {
    let k = this.kids.get(p.id);
    if (!k) this.kids.set(p.id, (k = { danced: 0, wobble: 0, cracked: false }));
    return k;
  },

  say(p, g, str, color) {
    this.feedback.push({ x: p.cx, y: Math.max(170 * g.u, p.px[0].y - 220 * g.u), t: 0, text: str, color });
  },

  update(g, dt) {
    const u = g.u;
    const players = g.activePlayers();
    this.t += dt;
    this.timer -= dt;
    for (const f of this.feedback) f.t += dt;
    this.feedback = this.feedback.filter((f) => f.t < FEEDBACK_TIME);

    if (this.phase === 'dance') {
      this.beat -= dt;
      if (this.beat <= 0) {
        this.beat += BEAT;
        (TUNE[Math.floor(this.t / BEAT) % TUNE.length] % 2 ? sfx.pop : sfx.tick)();
      }
      for (const p of players) {
        if (!isMoving(p, 'dance')) continue;
        const k = this.kid(p);
        k.danced += dt;
        if (k.danced >= DANCE_POINT) {
          k.danced -= DANCE_POINT;
          g.score(p, 1, p.cx, p.px[0].y - 120 * u);
        }
      }
      if (this.timer <= 0) {
        this.phase = 'freeze';
        this.timer = rand(FREEZE_TIME[0], FREEZE_TIME[1]);
        this.t = 0;
        for (const k of this.kids.values()) Object.assign(k, { wobble: 0, cracked: false });
        sfx.whoosh();
      }
      return;
    }

    // freeze
    if (this.t > GRACE) {
      for (const p of players) {
        const k = this.kid(p);
        if (k.cracked) continue;
        if (isMoving(p, 'freeze')) k.wobble += dt;
        if (k.wobble >= WOBBLE_FOR) {
          k.cracked = true;
          p.flashUntil = g.now + 0.7;
          p.flashColor = '#ff5a5a';
          g.burst(p.cx, p.sh.y, '#bfeaff', 20);
          sfx.splash();
          this.say(p, g, 'WOBBLE!', '#ff6b6b');
        }
      }
    }
    if (this.timer <= 0) {
      for (const p of players) {
        const k = this.kid(p);
        if (k.cracked) continue;
        g.score(p, FROZEN_POINTS, p.cx, p.px[0].y - 120 * u);
        p.flashUntil = g.now + 0.7;
        p.flashColor = '#4dff88';
        sfx.star();
        this.say(p, g, `FROZEN! +${FROZEN_POINTS}`, '#4dff88');
      }
      this.phase = 'dance';
      this.timer = rand(DANCE_TIME[0], DANCE_TIME[1]);
      this.t = 0;
      sfx.go();
    }
  },

  draw(g, ctx) {
    const u = g.u;
    const players = g.activePlayers();
    if (this.phase === 'dance') {
      const pulse = 1 + 0.08 * Math.sin(g.now * 16);
      text(ctx, '♪ DANCE! ♪', g.W / 2, 170 * u, 110 * u * pulse, { color: '#ffe14d' });
      // music notes bob over each kid who is dancing
      for (const p of players) {
        if (!isMoving(p, 'dance')) continue;
        const y = p.px[0].y - Math.max(130 * u, p.shoulderW * 1.1) + Math.sin(g.now * 10 + p.id) * 14 * u;
        text(ctx, '♫', p.cx + Math.sin(g.now * 3 + p.id) * 30 * u, y, 70 * u, { color: p.color });
      }
    } else {
      const come = Math.min(1, this.t / 0.25);
      text(ctx, 'FREEZE!', g.W / 2, 170 * u, 150 * u * (2 - come), { color: '#7fd0ff' });
      // an ice cube around each kid: clear while frozen, cracked when they wobbled
      for (const p of players) {
        const k = this.kids.get(p.id);
        const xs = p.px.map((q) => q.x);
        const ys = p.px.map((q) => q.y);
        const pad = 40 * u;
        const x0 = Math.min(...xs) - pad;
        const y0 = Math.min(...ys) - pad;
        const w = Math.max(...xs) + pad - x0;
        const h = Math.max(...ys) + pad - y0;
        ctx.save();
        ctx.globalAlpha = come * (k?.cracked ? 0.35 : 0.5);
        ctx.fillStyle = '#bfeaff';
        ctx.fillRect(x0, y0, w, h);
        ctx.globalAlpha = come;
        ctx.lineWidth = 8 * u;
        ctx.strokeStyle = k?.cracked ? '#ff6b6b' : '#ffffff';
        ctx.strokeRect(x0, y0, w, h);
        if (k?.cracked) {
          ctx.beginPath();
          ctx.moveTo(x0 + w * 0.2, y0);
          ctx.lineTo(x0 + w * 0.45, y0 + h * 0.3);
          ctx.lineTo(x0 + w * 0.3, y0 + h * 0.55);
          ctx.lineTo(x0 + w * 0.6, y0 + h);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    for (const f of this.feedback) {
      const a = f.t / FEEDBACK_TIME;
      const x = Math.min(g.W - 260 * u, Math.max(260 * u, f.x));
      ctx.save();
      ctx.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
      text(ctx, f.text, x, f.y - 60 * u * a, 84 * u, { color: f.color });
      ctx.restore();
    }
  },
};

export default freeze;
