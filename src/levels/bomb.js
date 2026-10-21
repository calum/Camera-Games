// Pass the bomb!: the third fort game (docs/FORT-GAMES.md), hot potato with a cartoon bomb. A fizzing bomb with a
// worried little face sits on someone's head. Throw it away (hand down, then up over your head, the arm pump) and
// it sails over to the next fort. Whoever has it when the fuse runs out goes BOOM: a sooty face, spiky black hair,
// smoke and a spin. Then a new bomb drops in.
//
// The goal has to be obvious in seconds, with no reading: the bomb is on YOUR head, it fizzes, it flashes red and
// shakes as it gets close, so you throw it. Funny comes first and nobody loses anything: every throw scores, and
// the kid who threw it last before the bang scores more; the one who went BOOM just looks silly. A kid on their own
// plays catch with the monkey (monkey.js), which panics, dithers, and sometimes holds on too long.
/** @import { Level, Game, Player, Scene } from '../types.js' */
/** @import { Fort } from '../forts.js' */
import { sfx } from '../audio.js';
import { text } from '../draw.js';
import { applyFort } from '../forts.js';
import { rng, vGradient, cloud, hills } from '../scene-kit.js';
import { drawMonkey } from './monkey.js';
import { rand, pick, forts, wobbleFort, spinFort, ArmPumps } from './kit.js';

const FUSE = [6, 10]; // s a new bomb's fuse lasts (random in this range): a few passes each
const HURRY = 2.2; // s left when the bomb starts flashing red and shaking
const FLIGHT = 1.0; // s a bomb takes from fort to fort: it hides the delay of a family guest too
const SETTLE = 0.45; // s a bomb has to sit on a head before it can be thrown again (no instant ping-pong)
const BOMB_R = 70; // u
const TOUCH_SLACK = 40; // u: a hand touching the bomb on your head also throws it (easier for the youngest)
const NEXT_BOMB = 1.6; // s after a bang before a new bomb drops in
const SOOT_TIME = 6; // s the soot stays (fading)
const MONKEY_HOLD = [0.7, 2.4]; // s the monkey dithers before it throws back (it hurries when the bomb flashes)
const MONKEY_SIZE = 200; // u
const WORDS = ['BOOM!', 'KABOOM!', 'BANG!', 'POOF!'];

/** @typedef {{ key: string, from: string, owner: Player | null, state: 'drop' | 'held' | 'fly', fuse: number, full: number, t: number, held: number, x: number, y: number, x0: number, y0: number, spin: number, wait: number, dead?: boolean }} Bomb */
/** @typedef {{ sootAt: number, booms: number }} KidState */

// A fort's key, so a bomb keeps its target while forts slide about: a kid's id, or the spare fort's slot.
const keyOf = (/** @type {Fort} */ f) => (f.id >= 0 ? `p${f.id}` : `s${f.i}`);

// The monkey in the spare fort, in fort space: standing behind the hedge, hopping about.
function monkeyIn(/** @type {Fort} */ f, /** @type {Game} */ g, panic = 0) {
  const s = MONKEY_SIZE * g.u;
  const x = f.cx + Math.sin(g.now * (1.3 + panic * 6) + f.i) * (40 + panic * 30) * g.u;
  const y = g.H - 160 * g.u - s * 0.85 - Math.abs(Math.sin(g.now * (4 + panic * 6))) * (14 + panic * 30) * g.u;
  return { x, y, s };
}

// A sunny park: the bomb's fizz and the soot show up well against it.
/** @type {Scene} */
const park = {
  static(ctx, W, H, u) {
    vGradient(ctx, W, H, [[0, '#6cc4ff'], [0.65, '#bfe8ff'], [1, '#e9f8ff']]);
    ctx.fillStyle = '#fff1a8';
    ctx.beginPath();
    ctx.arc(W * 0.88, H * 0.14, 80 * u, 0, Math.PI * 2);
    ctx.fill();
    hills(ctx, W, H, H * 0.68, '#8fd16a', 60 * u, 3);
    hills(ctx, W, H, H * 0.8, '#6dbb4c', 40 * u, 9);
  },
  dynamic(ctx, W, H, u, t) {
    for (let i = 0; i < 5; i++) {
      const r = rng(i * 11 + 5);
      const x = ((r() * W + t * (15 + r() * 20) * u) % (W + 400 * u)) - 200 * u;
      cloud(ctx, x, (60 + r() * 220) * u, (0.6 + r() * 0.6) * u, 0.9);
    }
  },
};

/** @satisfies {Level} */
const bomb = {
  id: 'bomb',
  title: 'Pass the bomb!',
  icon: '💣',
  hint: 'Bomb on your head? Hand down, then up high to throw it away!',
  color: '#ff9a3d',
  duration: 45,
  forts: true,
  backdrop: park,

  start() {
    this.pumps = new ArmPumps();
    /** @type {Bomb[]} */
    this.bombs = [];
    /** @type {Map<number, KidState>} */
    this.kids = new Map();
    /** @type {Map<number, { sootAt: number, spin: number }>} */
    this.monkeys = new Map();
    /** @type {{ txt: string, x: number, y: number, born: number, color: string, size: number }[]} */
    this.words = [];
    /** @type {{ x: number, y: number, r: number, born: number }[]} */
    this.smoke = [];
    this.nextIn = 0.8; // the first bomb drops in almost at once
    this.fizzAt = 0;
  },

  /** @param {Player} p @returns {KidState} */
  kid(p) {
    let k = this.kids.get(p.id);
    if (!k) this.kids.set(p.id, (k = { sootAt: -99, booms: 0 }));
    return k;
  },

  /** @param {number} i */
  monkey(i) {
    let s = this.monkeys.get(i);
    if (!s) this.monkeys.set(i, (s = { sootAt: -99, spin: 0 }));
    return s;
  },

  /** @param {Game} g @param {string} txt @param {number} x @param {number} y @param {string} [color] @param {number} [size] */
  say(g, txt, x, y, color = '#fff', size = rand(70, 95)) {
    this.words.push({ txt, x, y: Math.max(90 * g.u, y), born: g.now, color, size: size * g.u });
  },

  // Forts that can hold a bomb: a kid's, or the monkey's spare fort. An empty fort waiting for a kid can't.
  /** @param {Fort[]} all */
  players: (all) => all.filter((f) => f.p || f.id < 0),

  // Where a bomb thrown from fort `f` with a hand on side `dir` goes: the next fort that way, or the other way.
  // With two forts that is always the other one, so nobody has to aim.
  /** @param {Fort[]} all @param {Fort} f @param {number} dir */
  targetFor(all, f, dir) {
    const ok = this.players(all).filter((o) => o !== f);
    const near = (/** @type {Fort} */ a, /** @type {Fort} */ b) => Math.abs(a.cx - f.cx) - Math.abs(b.cx - f.cx);
    return ok.filter((o) => Math.sign(o.cx - f.cx) === dir).sort(near)[0] ?? ok.sort(near)[0] ?? null;
  },

  // Where a bomb sits in fort `f`: on the kid's head, or over the monkey's.
  /** @param {Game} g @param {Fort} f */
  seatOf(g, f) {
    const bob = Math.sin(g.now * 5) * 8 * g.u;
    if (f.p) {
      const sw = Math.max(20, f.p.shoulderW) * f.s;
      return { x: f.head.x, y: Math.max(BOMB_R * g.u, f.head.y - sw * 0.55 - BOMB_R * g.u * 0.9) + bob };
    }
    if (f.id < 0) {
      const m = monkeyIn(f, g);
      return { x: m.x, y: m.y - m.s * 1.45 + bob };
    }
    return { x: f.cx, y: g.H * 0.7 };
  },

  /** @param {Game} g @param {Bomb} b @param {Fort} from @param {Fort} to @param {Player | null} owner */
  throwBomb(g, b, from, to, owner) {
    b.state = 'fly';
    b.from = keyOf(from);
    b.key = keyOf(to);
    b.owner = owner;
    b.x0 = b.x;
    b.y0 = b.y;
    b.t = 0;
    b.spin = rand(-7, 7);
    sfx.swish();
    if (owner) g.score(owner, 1, b.x, b.y);
  },

  /** @param {Game} g @param {Fort[]} all */
  dropBomb(g, all) {
    const ok = this.players(all);
    if (!ok.length) return;
    // a new bomb would rather land on a kid than on the monkey
    const kids = ok.filter((f) => f.p);
    const f = pick(kids.length ? kids : ok);
    const at = this.seatOf(g, f);
    const full = rand(FUSE[0], FUSE[1]) / Math.max(0.6, g.diff);
    this.bombs.push({ key: keyOf(f), from: '', owner: null, state: 'drop', fuse: full, full, t: 0, held: 0, x: at.x, y: -BOMB_R * 2 * g.u, x0: at.x, y0: -BOMB_R * 2 * g.u, spin: 0, wait: rand(MONKEY_HOLD[0], MONKEY_HOLD[1]) });
    sfx.whistle();
  },

  update(g, dt) {
    const u = g.u;
    const all = forts(g);
    const byKey = new Map(all.map((f) => [keyOf(f), f]));
    const wanted = this.players(all).length >= 3 ? 2 : 1; // three or more players: two bombs going round

    // arm pumps: each kid's throws this frame (the pumps have to see every frame, bomb or not)
    /** @type {Map<string, { wrist: 15 | 16 }[]>} */
    const throws = new Map();
    for (const f of all) if (f.p) throws.set(keyOf(f), this.pumps.update(f.p, dt));

    if (this.bombs.length < wanted) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.nextIn = NEXT_BOMB;
        this.dropBomb(g, all);
      }
    }

    for (const b of this.bombs) {
      b.fuse = Math.max(0, b.fuse - dt);
      let at = byKey.get(b.key);
      if (!at || (!at.p && at.id >= 0)) {
        // its fort went, or is empty (the kid dropped out): it hops on to someone else
        const to = at ? this.targetFor(all, at, 1) : this.players(all)[0];
        if (!to) continue;
        if (b.state === 'held') {
          this.throwBomb(g, b, at ?? to, to, null);
        } else b.key = keyOf(to);
        at = to;
      }
      const seat = this.seatOf(g, at);

      if (b.state === 'drop') {
        // falls from the sky onto someone's head
        b.y += 900 * u * dt;
        b.x = seat.x;
        if (b.y >= seat.y) this.land(g, b, at);
        continue;
      }
      if (b.state === 'fly') {
        b.t += dt / FLIGHT;
        const t = Math.min(1, b.t);
        const arc = 180 * u + Math.abs(seat.x - b.x0) * 0.3;
        b.x = b.x0 + (seat.x - b.x0) * t;
        b.y = b.y0 + (seat.y - b.y0) * t - arc * 4 * t * (1 - t);
        if (b.t >= 1) this.land(g, b, at);
        continue;
      }

      // held: sits on the head, fizzing. The fuse can run out while it's flying, and then it goes off on landing
      b.held += dt;
      b.x = seat.x;
      b.y = seat.y;
      if (b.fuse <= 0) {
        this.boom(g, b, at);
        continue;
      }
      if (b.held < SETTLE) continue;
      if (at.p) {
        const pumps = throws.get(b.key) ?? [];
        const touch = at.hands.some((h) => Math.hypot(h.x - b.x, h.y - b.y) < BOMB_R * u + TOUCH_SLACK * u);
        if (pumps.length || touch) {
          const hand = pumps.length ? at.map(at.p.px[pumps[0].wrist]) : at.hands[0];
          const to = this.targetFor(all, at, Math.sign(hand.x - at.sh.x) || 1);
          if (to) this.throwBomb(g, b, at, to, at.p);
        }
      } else if (b.held > (b.fuse < HURRY ? Math.min(b.wait, 0.5) : b.wait)) {
        // the monkey throws it back to a kid (or the other monkey, when nobody plays)
        const kids = all.filter((o) => o.p);
        const to = kids.length ? pick(kids) : this.targetFor(all, at, 1);
        if (to) {
          this.throwBomb(g, b, at, to, null);
          if (Math.random() < 0.4) this.say(g, pick(['HOT HOT HOT!', 'EEK!', 'CATCH!', 'NOT ME!']), at.cx, b.y - 120 * u, '#ffd24d', 70);
        }
      }
    }
    this.bombs = this.bombs.filter((b) => !b.dead);

    // the fizz: faster as fuses get short
    const shortest = Math.min(99, ...this.bombs.filter((b) => b.state !== 'drop').map((b) => b.fuse));
    if (shortest < 99 && g.now - this.fizzAt > (shortest < HURRY ? 0.35 : 0.8)) {
      this.fizzAt = g.now;
      if (shortest < HURRY) sfx.tick();
      else sfx.fizz();
    }

    for (const m of this.monkeys.values()) m.spin = Math.max(0, m.spin - dt * 1.4);
    for (const s of this.smoke) s.y -= 60 * u * dt;
    this.smoke = this.smoke.filter((s) => g.now - s.born < 2.5);
    this.words = this.words.filter((w) => g.now - w.born < 1.2);
  },

  /** @param {Game} g @param {Bomb} b @param {Fort} f */
  land(g, b, f) {
    b.state = 'held';
    b.held = 0;
    b.wait = rand(MONKEY_HOLD[0], MONKEY_HOLD[1]);
    sfx.boop();
    if (f.p) wobbleFort(g, f.p, 2); // "THROW!" bounces over it (draw)
  },

  /** @param {Game} g @param {Bomb} b @param {Fort} f */
  boom(g, b, f) {
    b.dead = true;
    this.nextIn = NEXT_BOMB;
    sfx.kaboom();
    g.burst(b.x, b.y, '#ff9a3d', 30);
    g.burst(b.x, b.y, '#4a4a4a', 20);
    for (let i = 0; i < 6; i++) this.smoke.push({ x: b.x + rand(-80, 80) * g.u, y: b.y + rand(-40, 60) * g.u, r: rand(40, 80) * g.u, born: g.now + i * 0.08 });
    this.say(g, pick(WORDS), f.cx, b.y - 60 * g.u, '#ffd24d', 130);
    // the last kid to throw it got you: points for them (getting blown up never costs anything)
    const thrower = b.owner && b.owner !== f.p && g.activePlayers().includes(b.owner) ? b.owner : null;
    if (thrower) g.score(thrower, 2, b.x, b.y);
    if (f.p) {
      const k = this.kid(f.p);
      k.sootAt = g.now;
      k.booms++;
      spinFort(g, f.p);
    } else if (f.id < 0) {
      const m = this.monkey(f.i);
      m.sootAt = g.now;
      m.spin = 1;
    }
  },

  draw(g, ctx) {
    const u = g.u;
    const all = forts(g);
    for (const f of all) {
      if (f.p) this.drawSoot(g, ctx, f);
      else if (f.id < 0) {
        const m = this.monkey(f.i);
        const held = this.bombs.find((b) => b.key === keyOf(f) && b.state === 'held');
        const panic = held ? 1 : 0;
        const at = monkeyIn(f, g, panic);
        const sooty = g.now - m.sootAt < SOOT_TIME;
        const tilt = m.spin > 0 ? (1 - m.spin) ** 0.6 * Math.PI * 2 : panic * Math.sin(g.now * 20) * 0.12;
        drawMonkey(ctx, at.x, at.y, at.s, { t: g.now, arm: held ? 1 : 0, tilt, mud: sooty, dizzy: sooty, look: this.bombs[0] ?? null });
        if (sooty) hair(ctx, at.x, at.y - at.s * 0.95, at.s * 0.4, Math.min(1, (SOOT_TIME - (g.now - m.sootAt)) / 1.5));
      }
    }
    // a low hedge in front of each fort, with a flag in the kid's colour
    for (const f of all) {
      const top = g.H - 140 * u;
      ctx.fillStyle = '#3f9a3a';
      ctx.beginPath();
      ctx.moveTo(f.x0, g.H);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = f.x0 + ((i + 0.5) * (f.x1 - f.x0)) / n;
        ctx.moveTo(x, top);
        ctx.arc(x, top + 30 * u, ((f.x1 - f.x0) / n) * 0.62, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillRect(f.x0, top + 30 * u, f.x1 - f.x0, g.H - top);
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
    for (const s of this.smoke) {
      const age = g.now - s.born;
      if (age < 0) continue;
      ctx.globalAlpha = Math.max(0, 0.7 * (1 - age / 2.5));
      ctx.fillStyle = '#5b5b66';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 + age * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const b of this.bombs) {
      const hurry = b.state !== 'drop' && b.fuse < HURRY;
      const shake = hurry ? Math.sin(g.now * 50) * 6 * u : 0;
      const rot = b.state === 'fly' ? b.t * b.spin : Math.sin(g.now * 3) * 0.15;
      drawBomb(ctx, b.x + shake, b.y, BOMB_R * u, rot, b.fuse / b.full, hurry && Math.sin(g.now * 18) > 0, g.now);
      // a big pointer at the kid who has it, so a 4-year-old knows it's them
      const f = all.find((o) => keyOf(o) === b.key);
      if (b.state === 'held' && f?.p) {
        const bounce = Math.abs(Math.sin(g.now * 6)) * 14 * u;
        text(ctx, 'THROW!', b.x, b.y - BOMB_R * u - 70 * u - bounce, 54 * u, { color: hurry ? '#ff5a3a' : '#ffffff' });
      }
    }
    for (const w of this.words) {
      const age = g.now - w.born;
      const pop = age < 0.15 ? (age / 0.15) * 1.3 : 1.3 - Math.min(0.3, (age - 0.15) * 2);
      ctx.globalAlpha = Math.min(1, (1.2 - age) / 0.3);
      text(ctx, w.txt, w.x, w.y - age * 40 * u, w.size * pop, { color: w.color });
      ctx.globalAlpha = 1;
    }
  },

  // After a BOOM: soot on the face and spiky black hair, drawn in the kid's own picture space so they spin with
  // the kid. Sizes are in their shoulder widths.
  /** @param {Game} g @param {CanvasRenderingContext2D} ctx @param {Fort} f */
  drawSoot(g, ctx, f) {
    const p = /** @type {Player} */ (f.p);
    const age = g.now - this.kid(p).sootAt;
    if (age > SOOT_TIME) return;
    const sw = Math.max(20, p.shoulderW);
    const nose = p.px[0];
    ctx.save();
    applyFort(ctx, f, g.H, { slice: false });
    const fade = Math.min(1, (SOOT_TIME - age) / 1.5);
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = '#1e1e22';
    for (const [dx, dy, r] of [[-0.18, -0.05, 0.2], [0.2, 0.08, 0.17], [0, 0.22, 0.15], [-0.05, -0.25, 0.14]]) {
      ctx.beginPath();
      ctx.arc(nose.x + dx * sw, nose.y + dy * sw, r * sw, 0, Math.PI * 2);
      ctx.fill();
    }
    // two white eyes blinking out of the soot
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffffff';
    const blink = Math.sin(g.now * 3) > 0.95 ? 0.2 : 1;
    for (const ex of [-0.13, 0.13]) {
      ctx.beginPath();
      ctx.ellipse(nose.x + ex * sw, nose.y - 0.12 * sw, 0.07 * sw, 0.07 * sw * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    hair(ctx, nose.x, nose.y - sw * 0.2, sw * 0.42, fade);
    ctx.restore();
  },
};

// Blown-up hair: spikes sticking out all round the top of the head, (x, y) the middle of the head, w its radius.
function hair(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#1e1e22';
  ctx.beginPath();
  const n = 13;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * 1.05 + (i / n) * Math.PI * 0.9;
    const r = i % 2 ? w * 1.55 : w * 0.95;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// A round cartoon bomb with a worried face and a fuse that burns down (`left` 0..1), the spark at its end.
/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r @param {number} rot @param {number} left @param {boolean} red @param {number} t */
function drawBomb(ctx, x, y, r, rot, left, red, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // the fuse, curling up from the cap; shorter as it burns
  const len = r * (0.25 + 0.9 * Math.max(0, left));
  const fx = r * 0.35 + len * 0.6;
  const fy = -r * 1.05 - len * 0.6;
  ctx.strokeStyle = '#c9a36b';
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r * 0.3, -r * 0.95);
  ctx.quadraticCurveTo(r * 0.3 + len * 0.1, -r * 1.05 - len * 0.7, fx, fy);
  ctx.stroke();
  // the spark
  for (let i = 0; i < 6; i++) {
    const a = t * 13 + i;
    ctx.fillStyle = i % 2 ? '#ffe14d' : '#ff7a1f';
    ctx.beginPath();
    ctx.arc(fx + Math.cos(a) * r * 0.18, fy + Math.sin(a * 1.3) * r * 0.18, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#555c66';
  ctx.fillRect(r * 0.12, -r * 1.05, r * 0.36, r * 0.25); // the cap
  ctx.fillStyle = red ? '#e0302a' : '#24242b';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.4, -r * 0.4, r * 0.22, r * 0.14, -0.7, 0, Math.PI * 2);
  ctx.fill();
  // the face gets more worried as the fuse burns down
  const worry = 1 - Math.max(0, left);
  ctx.fillStyle = '#ffffff';
  for (const ex of [-0.3, 0.3]) {
    ctx.beginPath();
    ctx.arc(ex * r, -r * 0.05, r * (0.17 + worry * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  for (const ex of [-0.3, 0.3]) {
    ctx.beginPath();
    ctx.arc(ex * r, -r * 0.02, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  if (worry > 0.6) ctx.ellipse(0, r * 0.4, r * 0.14, r * 0.17, 0, 0, Math.PI * 2); // an "O" of horror
  else ctx.arc(0, r * 0.55, r * 0.22, Math.PI * 1.2, Math.PI * 1.8); // a wobbly frown
  ctx.stroke();
  ctx.restore();
}

export default bomb;
