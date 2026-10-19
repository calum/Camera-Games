// Fly high!: the second fort game (docs/FORT-GAMES.md). Every kid flies in their own column of sky. Flap your
// arms (down by your sides, then up over your head) to fly up, hold them out like a plane to glide, and you
// slowly sink otherwise. Stars float down past you: fly into them. Grumpy storm clouds float down too, and
// bumping one makes you spin out ("WHEEE!"), dizzy, and drop a bit. Now and then a tickly feather floats by:
// grab it and everyone else spins out.
//
// Kids stand still and move only their arms (a jump is a big boost, if they want). Funny comes first: spinning
// out is the joke, never a loss. A kid on their own flies alongside a winged monkey (monkey.js) in the spare
// fort, until someone joins and takes its place.
/** @import { Level, Game, Player, Scene } from '../types.js' */
/** @import { Fort } from '../forts.js' */
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { applyFort } from '../forts.js';
import { rng, vGradient, cloud } from '../scene-kit.js';
import { rand, pick, forts, spinFort, liftFort, ArmPumps } from './kit.js';
import { drawMonkey } from './monkey.js';

const FLAP = 520; // u/s upward speed a flap gives
const GRAVITY = 520; // u/s² pulling a kid back down
const GLIDE = 0.3; // gravity while gliding (arms out like a plane)
const TOP = 0.55; // the highest a kid flies, as a fraction of the screen height
const FALL_SPEED = 170; // u/s things float down the sky (it feels like flying up)
const STAR_EVERY = 1.1; // s between stars in each kid's column
const CLOUD_EVERY = 3.2; // s between storm clouds in each column
const FEATHER_EVERY = 11; // s between tickly feathers
const DIZZY = 1.6; // s of dizzy stars after a spin-out

/** @typedef {{ kind: 'star' | 'cloud' | 'feather', key: string, fx: number, y: number, r: number, born: number, dead?: boolean }} Thing
 *  fx: across the column (0..1); key: whose column (keyOf) */
/** @typedef {{ alt: number, vel: number, dizzy: number, star: number, cloud: number, flap: number, spin: number, aim: number, mx: number }} Flyer */

const MONKEY_SIZE = 150; // u
// A column's key: a kid's id, or the spare fort's slot (the monkey's column).
const keyOf = (/** @type {Fort} */ f) => (f.id >= 0 ? `p${f.id}` : `s${f.i}`);
// The monkey, flying `alt` px up its column.
const monkeyAt = (/** @type {Fort} */ f, /** @type {Game} */ g, /** @type {Flyer} */ fl) => ({ x: fl.mx || f.cx, y: g.H - 200 * g.u - fl.alt, s: MONKEY_SIZE * g.u });

// A sky that moves down past the kids: they are flying up.
/** @type {Scene} */
const sky = {
  static(ctx, W, H) {
    vGradient(ctx, W, H, [[0, '#3f8fe0'], [0.6, '#8fd0ff'], [1, '#d6f0ff']]);
  },
  dynamic(ctx, W, H, u, t) {
    for (let i = 0; i < 9; i++) {
      const r = rng(i * 7 + 3);
      const sp = (40 + r() * 60) * u;
      const x = r() * W - 100 * u;
      const y = ((r() * (H + 400 * u) + t * sp) % (H + 400 * u)) - 200 * u;
      cloud(ctx, x, y, (0.6 + r() * 0.8) * u, 0.75);
    }
  },
};

/** @satisfies {Level} */
const fly = {
  id: 'fly',
  title: 'Fly high!',
  icon: '🕊️',
  hint: 'Flap your arms to fly up! Arms out to glide. Catch the stars!',
  color: '#8fd0ff',
  duration: 40,
  forts: true,
  backdrop: sky,

  start() {
    this.pumps = new ArmPumps();
    /** @type {Map<string, Flyer>} */
    this.flyers = new Map();
    /** @type {Thing[]} */
    this.things = [];
    this.featherIn = FEATHER_EVERY * 0.6;
    /** @type {{ txt: string, x: number, y: number, born: number, color: string }[]} */
    this.words = [];
  },

  /** @param {string} key @returns {Flyer} */
  flyer(key) {
    let f = this.flyers.get(key);
    if (!f) this.flyers.set(key, (f = { alt: 0, vel: 0, dizzy: 0, star: rand(0.3, 1), cloud: CLOUD_EVERY * rand(0.6, 1), flap: 0, spin: 0, aim: 0.3, mx: 0 }));
    return f;
  },

  // The monkey's brain: it flaps when it's below where it wants to be, and wants to be at the next star.
  /** @param {Game} g @param {Fort} f @param {Flyer} fl */
  monkeyThinks(g, f, fl) {
    const key = keyOf(f);
    const next = this.things.find((t) => t.key === key && t.kind === 'star' && t.y > 0);
    const want = next ? Math.max(0, g.H - 200 * g.u - next.y) : g.H * fl.aim;
    if (Math.random() < 0.01) fl.aim = rand(0.1, TOP);
    const tx = next ? this.thingX(g, f, next) : f.cx;
    fl.mx = (fl.mx || f.cx) + (tx - (fl.mx || f.cx)) * 0.04; // drifts over towards it
    return fl.alt < want - 30 * g.u && fl.vel < 80 * g.u && Math.random() < 0.15;
  },

  /** @param {Game} g @param {string} txt @param {number} x @param {number} y @param {string} [color] */
  say(g, txt, x, y, color = '#fff') {
    this.words.push({ txt, x, y: Math.max(90 * g.u, y), born: g.now, color });
  },

  // Where a thing is across its kid's column (feathers drift from side to side).
  /** @param {Game} g @param {Fort} f @param {Thing} t */
  thingX: (g, f, t) => f.x0 + 60 * g.u + t.fx * (f.x1 - f.x0 - 120 * g.u) + (t.kind === 'feather' ? Math.sin(g.now * 2 + t.born) * 60 * g.u : 0),

  /** @param {Game} g @param {Fort} f @param {Flyer} fl */
  spinOut(g, f, fl) {
    if (f.p) spinFort(g, f.p);
    else fl.spin = 1;
    fl.dizzy = DIZZY;
    fl.vel = -FLAP * 0.6 * g.u;
    sfx.boing();
    const y = f.p ? f.head.y : monkeyAt(f, g, fl).y - MONKEY_SIZE * g.u;
    this.say(g, pick(f.p ? ['WHEEE!', 'WHOOPS!', 'DIZZY!', 'WOBBLE!'] : ['OOH OOH!', 'EEK!', 'WHEEE!']), f.cx, y - 180 * g.u, '#ffd24d');
    if (f.p) g.miss();
  },

  update(g, dt) {
    const u = g.u;
    const all = forts(g);
    const kids = all.filter((f) => f.p);
    // the flyers: the kids, and the monkey in a spare fort
    const flying = all.filter((f) => f.p || f.id < 0);
    const top = g.H * TOP;

    for (const f of flying) {
      const p = f.p;
      const key = keyOf(f);
      const fl = this.flyer(key);
      if (p ? this.pumps.update(p, dt).length : this.monkeyThinks(g, f, fl)) {
        fl.vel = FLAP * u * (fl.dizzy > 0 ? 0.6 : 1);
        fl.flap = 0.3;
        if (p) sfx.swish();
      }
      if (p && g.now - p.lastJump < dt * 1.5) fl.vel = FLAP * 1.4 * u; // a jump: a big boost
      fl.flap = Math.max(0, fl.flap - dt);
      fl.dizzy = Math.max(0, fl.dizzy - dt);
      fl.spin = Math.max(0, fl.spin - dt * 1.4);
      const glide = p?.pose.airplane && fl.vel < 0 ? GLIDE : 1;
      fl.vel -= GRAVITY * u * glide * dt;
      fl.alt += fl.vel * dt;
      if (fl.alt > top) {
        fl.alt = top;
        fl.vel = Math.min(0, fl.vel);
      }
      if (fl.alt < 0) {
        fl.alt = 0;
        fl.vel = 0;
      }
      if (p) liftFort(g, p, fl.alt);

      // things float down each kid's own column of sky
      fl.star -= dt * g.diff;
      fl.cloud -= dt * g.diff;
      if (fl.star <= 0) {
        fl.star = STAR_EVERY * rand(0.7, 1.3);
        this.things.push({ kind: 'star', key, fx: rand(0, 1), y: -60 * u, r: 50 * u, born: g.now });
      }
      if (fl.cloud <= 0) {
        fl.cloud = CLOUD_EVERY * rand(0.8, 1.3);
        this.things.push({ kind: 'cloud', key, fx: rand(0.2, 0.8), y: -120 * u, r: 85 * u, born: g.now });
      }
    }

    // a tickly feather drifts down someone's column: grab it and everybody else spins out
    this.featherIn -= dt;
    if (this.featherIn <= 0 && flying.length > 1) {
      this.featherIn = FEATHER_EVERY * rand(0.8, 1.2);
      this.things.push({ kind: 'feather', key: keyOf(pick(flying)), fx: rand(0.2, 0.8), y: -60 * u, r: 60 * u, born: g.now });
    }

    for (const t of this.things) {
      t.y += FALL_SPEED * u * g.diff * dt * (t.kind === 'feather' ? 0.7 : 1);
      const f = flying.find((k) => keyOf(k) === t.key);
      if (!f || t.y > g.H + 150 * u) {
        t.dead = t.y > g.H + 150 * u || !all.some((o) => keyOf(o) === t.key);
        continue;
      }
      const p = f.p;
      const fl = this.flyer(t.key);
      const x = this.thingX(g, f, t);
      let touching;
      if (p) touching = f.circles.some((c) => Math.hypot(c.x - x, c.y - t.y) < t.r + c.r * 0.8) || f.hands.some((h) => Math.hypot(h.x - x, h.y - t.y) < t.r + 30 * u);
      else {
        const m = monkeyAt(f, g, fl);
        touching = Math.hypot(x - m.x, t.y - m.y) < t.r + m.s * 0.6;
      }
      if (!touching) continue;
      t.dead = true;
      if (t.kind === 'star') {
        if (p) g.score(p, 1, x, t.y);
        g.burst(x, t.y, '#ffd24d', 14);
        sfx.star();
      } else if (t.kind === 'cloud') {
        g.burst(x, t.y, '#6f7f99', 18);
        sfx.thud();
        if (fl.dizzy <= 0) this.spinOut(g, f, fl);
      } else {
        if (p) g.score(p, 3, x, t.y);
        g.burst(x, t.y, '#ff9ad5', 24);
        sfx.raspberry();
        this.say(g, 'TICKLE ATTACK!', g.W / 2, 170 * u, '#ff9ad5');
        for (const o of flying) if (o !== f) this.spinOut(g, o, this.flyer(keyOf(o)));
      }
    }
    this.things = this.things.filter((t) => !t.dead);
    this.words = this.words.filter((w) => g.now - w.born < 1.2);
    // an empty fort waiting for a kid who dropped out: let them float back down
    for (const f of all) if (!f.p && f.id >= 0) this.flyers.delete(keyOf(f));
  },

  draw(g, ctx) {
    const u = g.u;
    const all = forts(g);
    for (const f of all) {
      if (f.p) this.drawWings(g, ctx, f);
      else if (f.id < 0) {
        const fl = this.flyer(keyOf(f));
        const m = monkeyAt(f, g, fl);
        const tilt = fl.spin > 0 ? (1 - fl.spin) ** 0.6 * Math.PI * 2 : Math.sin(g.now * 2) * 0.1;
        drawMonkey(ctx, m.x, m.y, m.s, { t: g.now, arm: fl.flap > 0 ? 1 : 0.3, wings: true, tilt, dizzy: fl.dizzy > 0, look: this.things.find((t) => t.key === keyOf(f)) ? { x: m.x, y: 0 } : null });
      }
    }
    for (const t of this.things) {
      const f = all.find((k) => keyOf(k) === t.key);
      if (!f) continue;
      const x = this.thingX(g, f, t);
      if (t.kind === 'star') star(ctx, x, t.y, t.r, g.now * 2 + t.born);
      else if (t.kind === 'cloud') stormCloud(ctx, x, t.y, t.r, g.now);
      else feather(ctx, x, t.y, t.r, Math.sin(g.now * 3 + t.born) * 0.6);
    }
    for (const w of this.words) {
      const age = g.now - w.born;
      const pop = age < 0.15 ? (age / 0.15) * 1.3 : 1.3 - Math.min(0.3, (age - 0.15) * 2);
      ctx.globalAlpha = Math.min(1, (1.2 - age) / 0.3);
      text(ctx, w.txt, w.x, w.y - age * 40 * u, 84 * u * pop, { color: w.color });
      ctx.globalAlpha = 1;
    }
  },

  // Wings on the kid's arms (from the shoulder to the wrist, so their arms ARE the wings), and dizzy stars.
  /** @param {Game} g @param {CanvasRenderingContext2D} ctx @param {Fort} f */
  drawWings(g, ctx, f) {
    const p = /** @type {Player} */ (f.p);
    const fl = this.flyer(keyOf(f));
    const sw = Math.max(20, p.shoulderW);
    ctx.save();
    applyFort(ctx, f, g.H, { slice: false });
    for (const [s, w] of [[11, 15], [12, 16]]) {
      const a = p.px[s];
      const b = p.px[w];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.max(sw * 0.8, Math.hypot(b.x - a.x, b.y - a.y) * 1.15);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? '#ffffff' : '#ffe9a8';
        ctx.beginPath();
        ctx.ellipse(len * (0.35 + k * 0.17), sw * (0.25 + k * 0.05), len * 0.32, sw * 0.18, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (fl.dizzy > 0) {
      const head = p.px[0];
      for (let k = 0; k < 3; k++) {
        const a = g.now * 6 + (k * Math.PI * 2) / 3;
        text(ctx, '⭐', head.x + Math.cos(a) * sw * 0.7, head.y - sw * 0.9 + Math.sin(a) * sw * 0.2, sw * 0.35);
      }
    }
    ctx.restore();
    // a shadow on the ground shows how high they are
    if (fl.alt > 20 * g.u) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(f.cx, g.H - 30 * g.u, sw * f.s * Math.max(0.3, 1 - fl.alt / g.H), 18 * g.u, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

function star(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r, /** @type {number} */ rot) {
  ctx.fillStyle = '#ffd21f';
  ctx.strokeStyle = '#c99400';
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot * 0.3 - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// A grumpy grey cloud with a frown and a little zigzag of lightning.
function stormCloud(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r, /** @type {number} */ t) {
  ctx.fillStyle = '#6f7f99';
  ctx.beginPath();
  for (const [dx, dy, rr] of [[-0.6, 0.1, 0.5], [0, -0.2, 0.65], [0.6, 0.1, 0.5], [0, 0.25, 0.5]]) {
    ctx.moveTo(x + dx * r + rr * r, y + dy * r);
    ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  for (const ex of [-0.25, 0.25]) {
    ctx.beginPath();
    ctx.arc(x + ex * r, y - 0.05 * r, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.arc(x, y + 0.3 * r, r * 0.22, Math.PI * 1.15, Math.PI * 1.85); // a frown
  ctx.stroke();
  if (Math.sin(t * 9) > 0.3) {
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(x + 0.2 * r, y + 0.6 * r);
    ctx.lineTo(x, y + 0.9 * r);
    ctx.lineTo(x + 0.2 * r, y + 0.95 * r);
    ctx.lineTo(x, y + 1.25 * r);
    ctx.stroke();
  }
}

function feather(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r, /** @type {number} */ rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(255,170,220,0.4)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff9ad5';
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.3, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.lineTo(0, -r);
  ctx.stroke();
  ctx.restore();
}

export default fly;
