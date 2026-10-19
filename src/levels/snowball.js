// Snowball fight: the first fort game (docs/FORT-GAMES.md). Every kid has their own snow fort, far apart on the
// screen even though they stand an arm's reach apart in the room. Put a hand down by your side to make a
// snowball, then lift it over your head to throw it at the next fort. Hits are silly, never bad: the kid who gets
// hit wobbles like a jelly, gets a splat on the face, a carrot nose, a growing pile of snow on their head, and
// after enough hits turns into a snowman for a moment. Now and then a bucket of mud floats over someone's fort:
// touch it and everyone else gets mud on them, which they wipe off with their hands.
//
// Funny comes first. Nobody loses anything: hits score for the thrower, catches and wiping score for you. A kid
// on their own plays against a cheeky monkey (monkey.js) in the spare fort, until someone joins and takes its place.
/** @import { Level, Game, Player } from '../types.js' */
/** @import { Fort } from '../forts.js' */
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { EXTRA_SCENES } from '../backdrops-extra.js';
import { applyFort } from '../forts.js';
import { drawMonkey, monkeyHead } from './monkey.js';
import { rand, pick, forts, wobbleFort, spinFort, ArmPumps } from './kit.js';

const FLIGHT = 1.1; // s a snowball takes from fort to fort: long enough to see it coming, and to try a catch
const BALL_R = 34; // u, a full-size snowball (a quick flick throws a smaller one)
const WIND_UP = 0.5; // s a hand has to be down to make a full-size snowball
const CATCH_SLACK = 55; // u: a hand this close to a snowball as it arrives catches it
const SPLAT_TIME = 5; // s a face splat stays (fading)
const CARROT_AT = 2; // hits before you get a carrot nose
const SNOWMAN_AT = 5; // hits that turn you into a snowman...
const SNOWMAN_TIME = 4; // ...for this long, then you melt back and start again
const MONKEY_EVERY = 2.6; // s between the monkey's throws (a lone kid's opponent, in the spare fort)
const MONKEY_SIZE = 200; // u
const MUD_EVERY = 9; // s between mud buckets
const MUD_STAY = 6; // s a bucket waits to be touched
const MUD_TIME = 12; // s mud stays if nobody wipes it off
const WORDS = ['SPLAT!', 'BONK!', 'SPLOOSH!', 'OOPS!', 'HA HA!', 'BOOF!', 'GOTCHA!'];

/** @typedef {{ dx: number, dy: number, r: number, born: number, rot: number }} Splat  offsets in shoulder widths from the nose */
/** @typedef {{ hits: number, splats: Splat[], mud: Splat[], snowmanUntil: number, carrotSince: number }} KidState */
/** @typedef {{ to: string, from: string, owner: Player | null, x0: number, y0: number, x: number, y: number, t: number, r: number, spin: number, dead?: boolean }} Ball */

// A fort's key, so a snowball keeps its target while forts slide about: a kid's id, or the spare fort's slot.
const keyOf = (/** @type {Fort} */ f) => (f.id >= 0 ? `p${f.id}` : `s${f.i}`);

// The monkey in the spare fort, in fort space: standing behind the wall, bobbing about.
function monkeyIn(/** @type {Fort} */ f, /** @type {Game} */ g) {
  const s = MONKEY_SIZE * g.u;
  const x = f.cx + Math.sin(g.now * 1.3 + f.i) * 40 * g.u;
  const y = g.H - 160 * g.u - s * 0.85 - Math.abs(Math.sin(g.now * 4)) * 14 * g.u;
  return { x, y, s, head: monkeyHead(x, y, s) };
}

/** @satisfies {Level} */
const snowball = {
  id: 'snowball',
  title: 'Snowball fight!',
  icon: '☃️',
  hint: 'Hand down to make a snowball, then throw it up high!',
  color: '#bfe3ff',
  duration: 45,
  forts: true,
  backdrop: EXTRA_SCENES.avalanche,

  start() {
    this.pumps = new ArmPumps();
    /** @type {Ball[]} */
    this.balls = [];
    /** @type {Map<number, KidState>} */
    this.kids = new Map();
    /** @type {Map<number, { hits: number, splatT: number, tilt: number, vel: number, next: number, wind: number, mud: number }>} */
    this.monkeys = new Map();
    /** @type {{ txt: string, x: number, y: number, born: number, color: string, size: number }[]} */
    this.words = [];
    /** @type {{ key: string, born: number } | null} */
    this.bucket = null;
    this.bucketIn = MUD_EVERY * 0.6;
    /** @type {{ x: number, y: number, vy: number, r: number, key: string, dead?: boolean }[]} */
    this.drops = [];
    this.wipeSound = 0;
  },

  /** @param {Player} p @returns {KidState} */
  kid(p) {
    let k = this.kids.get(p.id);
    if (!k) this.kids.set(p.id, (k = { hits: 0, splats: [], mud: [], snowmanUntil: 0, carrotSince: 0 }));
    return k;
  },

  /** @param {number} i */
  monkey(i) {
    let s = this.monkeys.get(i);
    if (!s) this.monkeys.set(i, (s = { hits: 0, splatT: 0, tilt: 0, vel: 0, next: MONKEY_EVERY, wind: 0, mud: 0 }));
    return s;
  },

  /** @param {Game} g @param {string} txt @param {number} x @param {number} y @param {string} [color] */
  say(g, txt, x, y, color = '#fff') {
    this.words.push({ txt, x, y: Math.max(90 * g.u, y), born: g.now, color, size: rand(70, 95) * g.u });
  },

  // Where a snowball thrown from fort `f` with a hand on side `dir` goes: the next fort that way, or the other way.
  /** @param {Fort[]} all @param {Fort} f @param {number} dir */
  targetFor(all, f, dir) {
    const ok = all.filter((o) => o !== f && (o.p || o.id < 0));
    const side = ok.filter((o) => Math.sign(o.cx - f.cx) === dir).sort((a, b) => Math.abs(a.cx - f.cx) - Math.abs(b.cx - f.cx));
    if (side.length) return side[0];
    return ok.sort((a, b) => Math.abs(a.cx - f.cx) - Math.abs(b.cx - f.cx))[0] ?? null;
  },

  /** @param {Game} g @param {Fort} f */
  aimAt(g, f) {
    if (f.p) return { x: f.head.x, y: f.head.y };
    if (f.id >= 0) return { x: f.cx, y: g.H * 0.75 }; // an empty fort: the snowball lands in the snow
    return monkeyIn(f, g).head;
  },

  /** @param {Game} g @param {Fort} from @param {Fort} to @param {Player | null} owner @param {number} x @param {number} y @param {number} size */
  throwBall(g, from, to, owner, x, y, size) {
    this.balls.push({ to: keyOf(to), from: keyOf(from), owner, x0: x, y0: y, x, y, t: 0, r: BALL_R * g.u * size, spin: rand(-8, 8) });
    sfx.swish();
  },

  update(g, dt) {
    const u = g.u;
    const all = forts(g);
    const byKey = new Map(all.map((f) => [keyOf(f), f]));

    // throws: a hand goes down (a snowball grows in it), then up over the head
    for (const f of all) {
      if (!f.p) continue;
      const k = this.kid(f.p);
      for (const { wrist, wound } of this.pumps.update(f.p, dt)) {
        const hand = f.map(f.p.px[wrist]);
        const to = this.targetFor(all, f, Math.sign(hand.x - f.sh.x) || 1);
        if (to) this.throwBall(g, f, to, f.p, hand.x, hand.y, 0.55 + 0.45 * Math.min(1, wound / WIND_UP));
      }
      if (k.snowmanUntil && g.now > k.snowmanUntil) {
        k.snowmanUntil = 0;
        k.hits = 0;
        k.carrotSince = 0;
        this.say(g, 'MELTED!', f.head.x, f.head.y - 160 * u, '#9fe0ff');
        sfx.splosh();
      }
      k.splats = k.splats.filter((s) => g.now - s.born < SPLAT_TIME);
      k.mud = k.mud.filter((s) => g.now - s.born < MUD_TIME);
      // wipe the mud off: a hand over a splat
      const sw = f.p.shoulderW * f.s;
      k.mud = k.mud.filter((m) => {
        const mx = f.head.x + m.dx * sw;
        const my = f.head.y + m.dy * sw;
        if (!f.hands.some((h) => Math.hypot(h.x - mx, h.y - my) < m.r * sw + 40 * u)) return true;
        g.burst(mx, my, '#7a4a22', 10);
        g.score(f.p, 1, mx, my);
        if (g.now - this.wipeSound > 0.12) sfx.squelch();
        this.wipeSound = g.now;
        return false;
      });
    }

    // the monkey in the spare fort throws back (only there when a kid plays alone, or nobody plays)
    for (const f of all) {
      if (f.p || f.id >= 0) continue;
      const s = this.monkey(f.i);
      s.vel += (-50 * s.tilt - 6 * s.vel) * dt;
      s.tilt += s.vel * dt;
      s.splatT = Math.max(0, s.splatT - dt);
      s.mud = Math.max(0, s.mud - dt);
      s.next -= dt * g.diff;
      s.wind = Math.max(0, s.wind - dt);
      if (s.next <= 0.5 && s.wind === 0 && s.next > 0) s.wind = 0.5; // raises its arm first: a warning
      if (s.next <= 0) {
        s.next = MONKEY_EVERY * rand(0.8, 1.3);
        const kidsForts = all.filter((o) => o.p);
        const to = kidsForts.length ? pick(kidsForts) : this.targetFor(all, f, 1);
        if (to) {
          const m = monkeyIn(f, g);
          this.throwBall(g, f, to, null, m.x + m.s * 0.4, m.y - m.s * 0.8, 0.85);
          if (Math.random() < 0.3) this.say(g, pick(['OOH OOH!', 'HEE HEE!', 'CATCH!']), m.x, m.head.y - 150 * u, '#ffd24d');
        }
      }
    }

    // snowballs in the air
    for (const b of this.balls) {
      const to = byKey.get(b.to);
      b.t += dt / FLIGHT;
      const aim = to ? this.aimAt(g, to) : { x: g.W / 2, y: g.H * 0.8 };
      const t = Math.min(1, b.t);
      const arc = 120 * u + Math.abs(aim.x - b.x0) * 0.3;
      b.x = b.x0 + (aim.x - b.x0) * t;
      b.y = b.y0 + (aim.y - b.y0) * t - arc * 4 * t * (1 - t);
      if (!to) {
        if (b.t >= 1) b.dead = true;
        continue;
      }
      // a catch: a hand right where the snowball arrives
      if (to.p && b.t > 0.7) {
        const slack = CATCH_SLACK * u + (to.p.remote ? 30 * u : 0); // guests see it a moment late
        if (to.hands.some((h) => Math.hypot(h.x - b.x, h.y - b.y) < b.r + slack)) {
          b.dead = true;
          g.score(to.p, 2, b.x, b.y);
          g.burst(b.x, b.y, '#ffffff', 16);
          this.say(g, 'CAUGHT IT!', b.x, b.y - 120 * u, '#7dff6b');
          sfx.gold();
          continue;
        }
      }
      if (b.t < 1) continue;
      b.dead = true;
      g.burst(b.x, b.y, '#ffffff', 22);
      if (to.p) this.hitKid(g, to, b);
      else if (to.id < 0) this.hitMonkey(g, to, b);
      else sfx.crunch(); // an empty fort: plop in the snow
    }
    this.balls = this.balls.filter((b) => !b.dead);

    this.updateMud(g, dt, all, byKey);
    this.words = this.words.filter((w) => g.now - w.born < 1.2);
  },

  /** @param {Game} g @param {Fort} f @param {Ball} b */
  hitKid(g, f, b) {
    const p = /** @type {Player} */ (f.p);
    const k = this.kid(p);
    k.hits++;
    if (b.owner && b.owner !== p) g.score(b.owner, 1, b.x, b.y);
    k.splats.push({ dx: rand(-0.35, 0.35), dy: rand(-0.4, 0.3), r: rand(0.35, 0.5), born: g.now, rot: rand(0, 6) });
    sfx.splat();
    wobbleFort(g, p, 6);
    if (k.hits === CARROT_AT) k.carrotSince = g.now;
    if (k.hits >= SNOWMAN_AT && !k.snowmanUntil) {
      k.snowmanUntil = g.now + SNOWMAN_TIME;
      spinFort(g, p);
      this.say(g, "YOU'RE A SNOWMAN!", f.cx, f.head.y - 200 * g.u, '#bfe3ff');
      sfx.raspberry();
    } else if (k.hits % 3 === 0) {
      spinFort(g, p);
      this.say(g, 'WHEEE!', f.head.x, f.head.y - 160 * g.u, '#ffd24d');
      sfx.boing();
    } else this.say(g, pick(WORDS), f.head.x, f.head.y - 150 * g.u);
  },

  /** @param {Game} g @param {Fort} f @param {Ball} b */
  hitMonkey(g, f, b) {
    const s = this.monkey(f.i);
    s.hits++;
    s.vel += 7 * (Math.random() < 0.5 ? -1 : 1);
    s.splatT = SPLAT_TIME / 2;
    s.next = Math.max(s.next, 1.2); // a moment to recover before it throws again
    if (b.owner) g.score(b.owner, 1, b.x, b.y);
    sfx.splat();
    this.say(g, pick(['EEK!', 'OOH OOH AAH!', 'BANANAS!', 'OI!']), f.cx, monkeyIn(f, g).head.y - 170 * g.u, '#ffd24d');
  },

  /** @param {Game} g @param {number} dt @param {Fort[]} all @param {Map<string, Fort>} byKey */
  updateMud(g, dt, all, byKey) {
    const u = g.u;
    const kidForts = all.filter((f) => f.p);
    // a bucket of mud floats over one kid's fort, just above their head: reach up and touch it
    this.bucketIn -= dt;
    if (!this.bucket && this.bucketIn <= 0 && kidForts.length) this.bucket = { key: keyOf(pick(kidForts)), born: g.now };
    const bf = this.bucket ? byKey.get(this.bucket.key) : null;
    if (this.bucket && (!bf?.p || g.now - this.bucket.born > MUD_STAY)) {
      this.bucket = null;
      this.bucketIn = MUD_EVERY;
    } else if (this.bucket && bf?.p) {
      const at = this.bucketAt(g, bf);
      if (bf.hands.some((h) => Math.hypot(h.x - at.x, h.y - at.y) < 60 * u + 45 * u)) {
        this.bucket = null;
        this.bucketIn = MUD_EVERY;
        g.score(bf.p, 2, at.x, at.y);
        g.burst(at.x, at.y, '#7a4a22', 26);
        this.say(g, 'MUD ATTACK!', g.W / 2, 160 * u, '#c98a4b');
        sfx.raspberry();
        for (const f of all) {
          if (f === bf || (!f.p && f.id >= 0)) continue;
          for (let i = 0; i < 6; i++) this.drops.push({ x: f.cx + rand(-0.3, 0.3) * (f.x1 - f.x0), y: -rand(40, 400) * u, vy: rand(500, 800) * u, r: rand(30, 50) * u, key: keyOf(f) });
        }
      }
    }
    // falling mud lands on whoever is in that fort
    for (const d of this.drops) {
      d.y += d.vy * dt;
      const f = byKey.get(d.key);
      const landY = f?.p ? f.head.y + rand(-0.2, 1.8) * f.p.shoulderW * f.s : g.H * 0.6;
      if (d.y < landY) continue;
      d.dead = true;
      sfx.splosh();
      if (f?.p) {
        const k = this.kid(f.p);
        const sw = f.p.shoulderW * f.s;
        k.mud.push({ dx: (d.x - f.head.x) / sw, dy: (d.y - f.head.y) / sw, r: rand(0.3, 0.45), born: g.now, rot: rand(0, 6) });
        wobbleFort(g, f.p, 3);
      } else if (f) this.monkey(f.i).mud = MUD_TIME / 2;
    }
    this.drops = this.drops.filter((d) => !d.dead);
  },

  /** @param {Game} g @param {Fort} f */
  bucketAt(g, f) {
    const sw = (f.p?.shoulderW ?? 100) * f.s;
    const bob = Math.sin(g.now * 3) * 12 * g.u;
    return { x: f.head.x + sw * 0.9, y: Math.max(110 * g.u, f.head.y - sw * 1.7) + bob };
  },

  draw(g, ctx) {
    const u = g.u;
    const all = forts(g);
    for (const f of all) {
      if (f.p) this.drawKid(g, ctx, f);
      else if (f.id < 0) this.drawMonkeyFort(g, ctx, f);
    }
    // the fort walls, in front of the kids' legs, with a flag in each kid's colour
    for (const f of all) {
      const w = f.x1 - f.x0;
      const top = g.H - 150 * u;
      ctx.fillStyle = '#f4f9ff';
      ctx.strokeStyle = '#a9c8e8';
      ctx.lineWidth = 6 * u;
      ctx.beginPath();
      ctx.moveTo(f.x0, g.H);
      for (let i = 0; i <= 6; i++) {
        const x = f.x0 + (w * i) / 6;
        ctx.lineTo(x, top + (i % 2 ? -18 : 12) * u);
      }
      ctx.lineTo(f.x1, g.H);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (!f.p) continue;
      const fx = f.x0 + 30 * u;
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(fx, top - 160 * u, 8 * u, 160 * u);
      ctx.fillStyle = f.p.color;
      ctx.beginPath();
      ctx.moveTo(fx + 8 * u, top - 160 * u);
      ctx.lineTo(fx + 90 * u, top - 130 * u + Math.sin(g.now * 6 + f.i) * 8 * u);
      ctx.lineTo(fx + 8 * u, top - 100 * u);
      ctx.fill();
    }
    // the mud bucket
    const bf = this.bucket ? all.find((f) => keyOf(f) === this.bucket?.key) : null;
    if (bf?.p) {
      const at = this.bucketAt(g, bf);
      const pulse = 1 + Math.sin(g.now * 8) * 0.08;
      ctx.fillStyle = 'rgba(255,220,120,0.35)';
      ctx.beginPath();
      ctx.arc(at.x, at.y, 85 * u * pulse, 0, Math.PI * 2);
      ctx.fill();
      bucket(ctx, at.x, at.y, 90 * u * pulse, Math.sin(g.now * 4) * 0.15);
      text(ctx, 'MUD!', at.x, at.y - 95 * u, 46 * u, { color: '#c98a4b' });
    }
    ctx.fillStyle = '#7a4a22';
    for (const d of this.drops) blob(ctx, d.x, d.y, d.r, d.y * 0.01);
    // snowballs, with a little shadow trail
    for (const b of this.balls) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(b.x - (b.x - b.x0) * 0.04, b.y + 6 * u, b.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      snowballShape(ctx, b.x, b.y, b.r, b.t * b.spin);
    }
    // big comic words that bounce in
    for (const w of this.words) {
      const age = g.now - w.born;
      const pop = age < 0.15 ? age / 0.15 * 1.3 : 1.3 - Math.min(0.3, (age - 0.15) * 2);
      ctx.globalAlpha = Math.min(1, (1.2 - age) / 0.3);
      text(ctx, w.txt, w.x, w.y - age * 40 * u, w.size * pop, { color: w.color });
      ctx.globalAlpha = 1;
    }
  },

  // Everything stuck on a kid is drawn in the kid's own picture space (applyFort, inside forts.js's transform), so
  // it wobbles and spins with them. Sizes are in their shoulder widths.
  /** @param {Game} g @param {CanvasRenderingContext2D} ctx @param {Fort} f */
  drawKid(g, ctx, f) {
    const p = /** @type {Player} */ (f.p);
    const k = this.kid(p);
    const sw = Math.max(20, p.shoulderW);
    const nose = p.px[0];
    ctx.save();
    applyFort(ctx, f, g.H, { slice: false }); // the picture's own transform, so these stick to the kid

    if (k.snowmanUntil) drawSnowmanSuit(ctx, p, sw, g.now);
    // a pile of snow on the head that grows with every hit
    const pile = Math.min(k.hits, SNOWMAN_AT);
    if (pile > 0 && !k.snowmanUntil) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cfe3f5';
      ctx.lineWidth = 0.04 * sw;
      for (let i = 0; i < pile; i++) {
        const y = nose.y - sw * (0.85 + i * 0.22);
        ctx.beginPath();
        ctx.ellipse(nose.x + Math.sin(i * 2.1) * 0.08 * sw, y, sw * (0.55 - i * 0.07), sw * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // splats on the face, fading
    for (const s of k.splats) {
      ctx.globalAlpha = Math.min(1, (SPLAT_TIME - (g.now - s.born)) / 1.5);
      ctx.fillStyle = '#ffffff';
      blob(ctx, nose.x + s.dx * sw, nose.y + s.dy * sw, s.r * sw, s.rot);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a4a22';
    for (const m of k.mud) blob(ctx, nose.x + m.dx * sw, nose.y + m.dy * sw, m.r * sw, m.rot);
    if (k.carrotSince || k.snowmanUntil) carrot(ctx, nose.x, nose.y, sw, Math.min(1, (g.now - (k.carrotSince || g.now - 1)) * 4));
    // a snowball growing in each hand that is down by the side
    for (const w of /** @type {(15 | 16)[]} */ ([15, 16])) {
      if (!this.pumps.isDown(p, w)) continue;
      const grow = 0.55 + 0.45 * Math.min(1, this.pumps.wound(p, w) / WIND_UP);
      snowballShape(ctx, p.px[w].x, p.px[w].y, (BALL_R * g.u * grow) / f.s, g.now * 2);
    }
    ctx.restore();
  },

  /** @param {Game} g @param {CanvasRenderingContext2D} ctx @param {Fort} f */
  drawMonkeyFort(g, ctx, f) {
    const s = this.monkey(f.i);
    const m = monkeyIn(f, g);
    drawMonkey(ctx, m.x, m.y, m.s, {
      t: g.now,
      arm: s.wind > 0 ? 1 : 0,
      tilt: s.tilt * 0.5,
      mud: s.mud > 0,
      splat: Math.min(1, s.splatT),
      look: this.balls[0] ?? null,
    });
    if (s.wind > 0) snowballShape(ctx, m.x + m.s * 0.4, m.y - m.s * 0.85, 26 * g.u, 0);
  },
};

// A lumpy splat: a circle with bumps.
function blob(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r, /** @type {number} */ rot) {
  ctx.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = rot + (i / 14) * Math.PI * 2;
    const rr = r * (i % 2 ? 0.72 : 1) * (1 + 0.15 * Math.sin(i * 3.7 + rot));
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function snowballShape(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r, /** @type {number} */ rot) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#a9c8e8';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d8e9f8';
  ctx.beginPath();
  ctx.arc(x + Math.cos(rot) * r * 0.35, y + Math.sin(rot) * r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

// A carrot nose pointing out to the side, `grow` 0..1 as it pops on.
function carrot(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ sw, /** @type {number} */ grow) {
  const len = sw * 0.55 * grow;
  ctx.fillStyle = '#ff8a1f';
  ctx.strokeStyle = '#c4580c';
  ctx.lineWidth = sw * 0.02;
  ctx.beginPath();
  ctx.moveTo(x, y - sw * 0.07);
  ctx.lineTo(x + len, y + sw * 0.03);
  ctx.lineTo(x, y + sw * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// A bucket brimming with mud.
function bucket(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.strokeStyle = '#555c66';
  ctx.lineWidth = w * 0.06;
  ctx.beginPath();
  ctx.arc(0, -w * 0.35, w * 0.5, Math.PI, 0); // the handle
  ctx.stroke();
  ctx.fillStyle = '#8f9aa8';
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, -w * 0.35);
  ctx.lineTo(w * 0.55, -w * 0.35);
  ctx.lineTo(w * 0.4, w * 0.45);
  ctx.lineTo(-w * 0.4, w * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a4a22';
  blob(ctx, 0, -w * 0.4, w * 0.5, 0.3); // mud spilling over the top
  blob(ctx, w * 0.3, -w * 0.05, w * 0.14, 1); // and a drip down the side
  ctx.restore();
}

function topHat(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#1d1d26';
  ctx.fillRect(-w * 0.75, -w * 0.08, w * 1.5, w * 0.16);
  ctx.fillRect(-w * 0.45, -w * 0.9, w * 0.9, w * 0.85);
  ctx.fillStyle = '#d33';
  ctx.fillRect(-w * 0.45, -w * 0.3, w * 0.9, w * 0.14);
  ctx.restore();
}

// A kid turned into a snowman: snow balls over their body (their face still shows), stick arms that follow their
// own arms, coal buttons and a top hat.
function drawSnowmanSuit(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {Player} */ p, /** @type {number} */ sw, /** @type {number} */ now) {
  const px = p.px;
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineCap = 'round';
  ctx.lineWidth = sw * 0.08;
  ctx.beginPath();
  for (const [a, b] of [[11, 15], [12, 16]]) {
    ctx.moveTo(px[a].x, px[a].y);
    ctx.lineTo(px[b].x, px[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#b9d3ea';
  ctx.lineWidth = sw * 0.04;
  const belly = { x: p.hip.x, y: p.hip.y + sw * 0.2, r: sw * 1.0 };
  const chest = { x: p.sh.x, y: p.sh.y + sw * 0.35, r: sw * 0.72 };
  for (const c of [belly, chest]) {
    ctx.beginPath();
    ctx.arc(c.x, c.y + Math.sin(now * 5) * sw * 0.02, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#1b1b1b';
  for (const t of [0, 0.4, 0.8]) {
    ctx.beginPath();
    ctx.arc(p.sh.x, chest.y - chest.r * 0.4 + t * chest.r, sw * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  topHat(ctx, px[0].x, px[0].y - sw * 0.75, sw * 0.6, Math.sin(now * 4) * 0.15);
}

export default snowball;
