// Fort games (docs/FORT-GAMES.md): the fort layout, the arm-pump throw, and the rules of the two fort games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FortLayout, FORT, syncForts } from '../../src/forts.js';
import { ArmPumps } from '../../src/levels/kit.js';
import { computeFeatures } from '../../src/tracker.js';
import { LEVELS } from '../../src/levels/index.js';

const snowball = LEVELS.find((l) => l.id === 'snowball');
const fly = LEVELS.find((l) => l.id === 'fly');
const bomb = LEVELS.find((l) => l.id === 'bomb');

// A standing kid at x. arms: 'down' (wrists by the hips), 'up' (over the head) or 'side'.
function kid(id, x, arms = 'side') {
  const p = { id, slot: id, color: '#f0f', present: true, score: 0, jumps: 0, lastJump: -99, hitUntil: 0, pose: {}, px: null };
  p.set = (a, t = 0) => {
    const wy = a === 'down' ? 560 : a === 'up' ? 120 : 330;
    const px = Array.from({ length: 33 }, () => ({ x, y: 600 }));
    const put = (i, dx, y) => (px[i] = { x: x + dx, y });
    put(0, 0, 250); put(11, -60, 330); put(12, 60, 330);
    put(15, -100, wy); put(16, 100, wy); put(19, -105, wy - 10); put(20, 105, wy - 10);
    put(23, -45, 560); put(24, 45, 560); put(25, -45, 760); put(26, 45, 760); put(27, -45, 950); put(28, 45, 950);
    p.px = px;
    computeFeatures(p, t, { skipJump: true });
  };
  p.set(arms);
  return p;
}

function makeG(players) {
  return {
    W: 1920, H: 1080, u: 1, now: 0, diff: 1, ease: 1, round: 0, fx: true, players,
    team: { score: 0, hearts: 5, maxHearts: 5 },
    activePlayers() {
      return this.players.filter((p) => p.present && !p.excluded);
    },
    score(p, pts) {
      if (p) p.score += pts;
      this.team.score += pts;
    },
    burst() {},
    miss() {},
    endLevel() {},
  };
}

test('forts: kids standing side by side get forts spread across the screen, left to right', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const forts = new FortLayout().update([b, a], 1920, 1080, 0.02);
  assert.equal(forts.length, 2);
  assert.equal(forts[0].p, a, 'the kid on the left gets the left fort');
  assert.ok(forts[1].cx - forts[0].cx > 800, 'far apart in the game, though 100 px apart in the room');
  // their bodies are mapped into their own forts
  for (const f of forts) assert.ok(f.head.x > f.x0 && f.head.x < f.x1, `kid ${f.id} is in their fort`);
  // and each kid's slice of the camera picture stops halfway to the other kid
  assert.equal(forts[0].src1, 950);
  assert.equal(forts[1].src0, 950);
});

test('forts: a kid alone gets a spare fort (for the monkey); someone who joins takes it, and nobody else moves', () => {
  const layout = new FortLayout();
  const a = kid(1, 1200);
  let forts = layout.update([a], 1920, 1080, 0.02);
  assert.equal(forts.length, FORT.minForts);
  assert.equal(forts[0].p, a);
  assert.equal(forts[1].p, null);
  assert.equal(forts[1].id, -1, 'a spare fort');
  const before = forts[0].cx;
  const b = kid(2, 300); // stands on the left, but joins later
  forts = layout.update([a, b], 1920, 1080, 0.02);
  assert.equal(forts[0].p, a, 'the first kid keeps their fort');
  assert.equal(forts[1].p, b, 'the new kid takes the spare fort');
  assert.equal(forts[0].cx, before);
  const c = kid(3, 1600);
  forts = layout.update([a, b, c], 1920, 1080, 0.02);
  assert.equal(forts.length, 3, 'a third player adds a fort');
  assert.equal(forts[2].p, c);
});

test('forts: nothing pops. A kid lost for a moment keeps an empty fort, and forts slide rather than jump', () => {
  const layout = new FortLayout();
  const a = kid(1, 700);
  const b = kid(2, 900);
  const c = kid(3, 1100);
  layout.update([a, b, c], 1920, 1080, 0.02);
  let forts = layout.update([a, c], 1920, 1080, 0.5); // b drops out of tracking
  assert.equal(forts.length, 3, 'b keeps their fort for a while');
  assert.equal(forts[1].p, null);
  assert.equal(forts[1].id, 2);
  for (let t = 0; t < FORT.keep + 0.5; t += 0.5) forts = layout.update([a, c], 1920, 1080, 0.5);
  assert.equal(forts.length, 2, 'then it goes');
  const w = forts[1].x1 - forts[1].x0;
  forts = layout.update([a, c], 1920, 1080, 0.02);
  const w2 = forts[1].x1 - forts[1].x0;
  assert.ok(Math.abs(w2 - w) < 300, 'the forts widen bit by bit');
});

test('forts: a kid who would not fit with arms out is shrunk, never grown', () => {
  const big = kid(1, 900);
  big.shoulderW = 400;
  const forts = new FortLayout().update([big, kid(2, 1400), kid(3, 1500), kid(4, 1600)], 1920, 1080, 0.02);
  assert.ok(forts[0].s < 1);
  assert.ok(forts[0].s >= FORT.minScale);
  assert.ok(forts.every((f) => f.s <= 1));
});

test('forts: syncForts updates once per game time, so a level and main.js can both ask', () => {
  const g = makeG([kid(1, 900)]);
  const first = syncForts(g);
  assert.equal(syncForts(g), first, 'same frame, same forts');
  g.now += 0.02;
  assert.notEqual(syncForts(g), first);
});

test('arm pumps: a hand goes down, then up over the head = a throw; up on its own is not', () => {
  const pumps = new ArmPumps();
  const p = kid(1, 900, 'up');
  assert.equal(pumps.update(p, 0.1).length, 0, 'arms already up when the game starts: nothing');
  p.set('side');
  assert.equal(pumps.update(p, 0.1).length, 0);
  p.set('down');
  assert.equal(pumps.update(p, 0.1).length, 0, 'winding up');
  assert.ok(pumps.isDown(p, 15));
  p.set('down');
  pumps.update(p, 0.3);
  p.set('up');
  const thrown = pumps.update(p, 0.1);
  assert.equal(thrown.length, 2, 'both hands threw');
  assert.ok(thrown[0].wound >= 0.3, 'how long it was wound up');
  p.set('up');
  assert.equal(pumps.update(p, 0.1).length, 0, 'keeping it up does not throw again');
});

// Play the level for `secs`, with `each(t)` run every frame first.
function run(level, g, secs, each = () => {}) {
  for (let t = 0; t < secs; t += 0.05) {
    g.now += 0.05;
    each(g.now);
    level.update(g, 0.05);
  }
}

test('snowball fight: a throw flies to the other fort and scores for the thrower', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const g = makeG([a, b]);
  snowball.start(g);
  run(snowball, g, 0.3);
  a.set('down', g.now);
  run(snowball, g, 0.6);
  a.set('up', g.now);
  run(snowball, g, 0.1);
  assert.equal(snowball.balls.length, 2, 'a snowball from each hand');
  run(snowball, g, 1.5);
  assert.equal(a.score, 2, 'two hits');
  assert.equal(snowball.kids.get(2).hits, 2, 'b was hit');
  assert.equal(b.score, 0, 'getting hit costs nothing');
});

test('snowball fight: a hand where the snowball arrives catches it', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const g = makeG([a, b]);
  snowball.start(g);
  run(snowball, g, 0.2);
  a.set('down', g.now);
  run(snowball, g, 0.5);
  a.set('up', g.now);
  // b holds both hands right in front of their face
  run(snowball, g, 1.5, () => (b.hands = b.hands.map(() => ({ ...b.px[0] }))));
  assert.ok(b.score >= 2, 'a catch scores for the catcher');
  assert.equal(snowball.kids.get(2)?.hits ?? 0, 0, 'and it is not a hit');
});

test('snowball fight: a kid alone plays the monkey, which throws back', () => {
  const a = kid(1, 900);
  const g = makeG([a]);
  snowball.start(g);
  run(snowball, g, 8);
  assert.ok(snowball.kids.get(1)?.hits > 0, 'the monkey hit the kid');
  // and the kid can hit the monkey
  a.set('down', g.now);
  run(snowball, g, 0.5);
  a.set('up', g.now);
  run(snowball, g, 1.5);
  assert.ok(a.score > 0);
  assert.ok(snowball.monkeys.get(1).hits > 0);
});

test('snowball fight: mud lands on the others and they wipe it off with their hands for points', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const g = makeG([a, b]);
  snowball.start(g);
  snowball.bucketIn = 0;
  run(snowball, g, 0.1);
  assert.ok(snowball.bucket, 'a bucket of mud appears');
  const owner = snowball.bucket.key === 'p1' ? a : b;
  const other = owner === a ? b : a;
  const f = syncForts(g).find((q) => q.p === owner);
  const at = snowball.bucketAt(g, f);
  // the owner reaches up and touches it (put the hands where the bucket is, in camera space)
  const cam = { x: f.home + (at.x - f.cx) / f.s, y: g.H + (at.y - g.H) / f.s };
  owner.hands = owner.hands.map(() => ({ ...cam }));
  run(snowball, g, 0.05);
  assert.equal(snowball.bucket, null, 'touched');
  assert.equal(owner.score, 2);
  // the other kid's hands out of the way while the mud falls, or a splat landing by a hand is wiped at once
  const hands = other.hands;
  other.hands = hands.map(() => ({ x: -5000, y: -5000 }));
  run(snowball, g, 3);
  other.hands = hands;
  const mud = snowball.kids.get(other.id).mud.length;
  assert.ok(mud > 0, 'mud landed on the other kid');
  // the other kid rubs where the first splat is (mud lands at random spots, so aim at one rather than rubbing a
  // fixed patch, which missed every splat now and then and failed the publish)
  const before = other.score;
  run(snowball, g, 1, (t) => {
    const m = snowball.kids.get(other.id).mud[0];
    if (!m) return;
    const fo = syncForts(g).find((q) => q.p === other);
    const sw = other.shoulderW * fo.s;
    const x = fo.head.x + m.dx * sw;
    const y = fo.head.y + m.dy * sw;
    const ph = t * 20;
    other.hands = other.hands.map((_, i) => ({ x: fo.home + (x - fo.cx) / fo.s + Math.sin(ph + i) * 20, y: g.H + (y - g.H) / fo.s }));
  });
  assert.ok(snowball.kids.get(other.id).mud.length < mud, 'some mud wiped off');
  assert.ok(other.score > before, 'wiping scores');
});

test('fly high: flapping lifts the kid in their fort, and they sink back down', () => {
  const a = kid(1, 900);
  const g = makeG([a]);
  fly.start(g);
  run(fly, g, 0.2);
  for (let i = 0; i < 3; i++) {
    a.set('down', g.now);
    run(fly, g, 0.2);
    a.set('up', g.now);
    run(fly, g, 0.2);
  }
  const high = syncForts(g)[0].lift;
  assert.ok(high > 50, `flew up (${high})`);
  run(fly, g, 4);
  assert.ok(syncForts(g)[0].lift < high, 'gravity');
});

test('fly high: a lone kid flies alongside the monkey; a storm cloud spins a kid out', () => {
  const a = kid(1, 900);
  const g = makeG([a]);
  fly.start(g);
  run(fly, g, 0.1);
  assert.ok(fly.flyers.has('s1'), 'the monkey flies in the spare fort');
  const f = syncForts(g)[0];
  fly.things.push({ kind: 'cloud', key: 'p1', fx: 0.5, y: f.head.y, r: 85, born: g.now });
  // put the cloud right on the kid
  const thingX = fly.thingX;
  fly.thingX = () => f.head.x;
  run(fly, g, 0.05);
  fly.thingX = thingX;
  assert.ok(fly.flyers.get('p1').dizzy > 0, 'dizzy');
  assert.ok(g.fortLayout.slots[0].spin > 0, 'spinning');
});

// Pass the bomb: let the first bomb drop in, and say who has it.
function bombIn(g) {
  bomb.start(g);
  run(bomb, g, 2);
  assert.equal(bomb.bombs.length, 1, 'a bomb dropped in');
  assert.equal(bomb.bombs[0].state, 'held', 'and landed on a head');
  return bomb.bombs[0];
}

// An arm pump by kid p: hand down, then up over the head.
function pump(level, g, p) {
  p.set('down', g.now);
  run(level, g, 0.3);
  p.set('up', g.now);
  run(level, g, 0.1);
  p.set('side', g.now);
}

test('pass the bomb: it lands on a kid; an arm pump throws it to the other fort and scores', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const g = makeG([a, b]);
  const bm = bombIn(g);
  bm.fuse = bm.full = 30;
  const [holder, other] = bm.key === 'p1' ? [a, b] : [b, a];
  pump(bomb, g, other);
  assert.equal(bm.key, `p${holder.id}`, "the other kid's arm pump does nothing to it");
  pump(bomb, g, holder);
  assert.equal(bm.state, 'fly');
  assert.equal(bm.key, `p${other.id}`, 'it flies to the other fort');
  assert.equal(holder.score, 1, 'a throw scores');
  run(bomb, g, 1.2);
  assert.equal(bm.state, 'held', 'and lands on the other kid');
});

test('pass the bomb: a hand touching the bomb on your head throws it too', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const g = makeG([a, b]);
  const bm = bombIn(g);
  bm.fuse = bm.full = 30;
  const holder = bm.key === 'p1' ? a : b;
  const fo = syncForts(g).find((q) => q.p === holder);
  holder.hands = holder.hands.map(() => ({ x: fo.home + (bm.x - fo.cx) / fo.s, y: g.H + (bm.y - g.H) / fo.s }));
  run(bomb, g, 0.1);
  assert.equal(bm.state, 'fly');
});

test('pass the bomb: BOOM on whoever has it, soot and a spin, and points for the kid who threw it, none lost', () => {
  const a = kid(1, 900);
  const b = kid(2, 1000);
  const g = makeG([a, b]);
  const bm = bombIn(g);
  bm.fuse = 30;
  const [thrower, victim] = bm.key === 'p1' ? [a, b] : [b, a];
  pump(bomb, g, thrower);
  bm.fuse = 1.2; // it lands, then goes off before the victim throws it back
  run(bomb, g, 1.5);
  assert.equal(bomb.bombs.length, 0, 'it went off');
  assert.equal(bomb.kids.get(victim.id).booms, 1, 'on the kid holding it');
  assert.ok(g.now - bomb.kids.get(victim.id).sootAt < 1, 'who is sooty now');
  assert.equal(victim.score, 0, 'and loses nothing');
  assert.equal(thrower.score, 3, 'the throw and the bang score for the thrower');
  run(bomb, g, 2.5);
  assert.equal(bomb.bombs.length, 1, 'a new bomb drops in');
});

test('pass the bomb: a kid alone plays catch with the monkey, which can get blown up too', () => {
  const a = kid(1, 900);
  const g = makeG([a]);
  const bm = bombIn(g);
  assert.equal(bm.key, 'p1', 'a new bomb lands on the kid, not the monkey');
  bm.fuse = bm.full = 30;
  pump(bomb, g, a);
  assert.equal(bm.key, 's1', 'thrown to the monkey');
  for (let i = 0; i < 100 && !(bm.key === 'p1' && bm.state === 'held'); i++) run(bomb, g, 0.05);
  assert.equal(bm.key, 'p1', 'the monkey throws it back');
  run(bomb, g, 0.5);
  pump(bomb, g, a);
  assert.equal(bm.key, 's1');
  run(bomb, g, 1.1);
  bm.fuse = 0.05;
  run(bomb, g, 0.2);
  assert.ok(g.now - bomb.monkeys.get(1).sootAt < 1, 'BOOM, a sooty monkey');
  assert.equal(a.score, 4, 'two throws, and the bang');
});
