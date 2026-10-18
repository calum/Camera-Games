// Unit tests for Keep it up! (balloons), driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import balloons, { balloonTarget, tap } from '../../src/levels/balloons.js';

function makeG(players = []) {
  return {
    W: 1920,
    H: 1080,
    u: 1,
    now: 0,
    diff: 1,
    players,
    team: { score: 0, hearts: 5, maxHearts: 5 },
    levelEnd: null,
    activePlayers() {
      return this.players.filter((p) => p.present);
    },
    score(p, pts) {
      if (p) p.score += pts;
      this.team.score += pts;
    },
    burst() {},
    endLevel(msg) {
      if (!this.levelEnd) this.levelEnd = msg;
    },
  };
}

const far = { x: -999, y: -999 };
function kid(over = {}) {
  return {
    id: over.id ?? 1,
    present: true,
    score: 0,
    cx: 960,
    px: Array.from({ length: 33 }, () => far),
    hands: [far],
    ...over,
  };
}

const balloon = (over = {}) => ({ x: 960, y: 500, vx: 0, vy: 100, r: 80, color: '#f00', cool: 0, wob: 0, ...over });

function run(g, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.now += 1 / 60;
    balloons.update(g, 1 / 60);
  }
}

test('balloons: interface', () => {
  for (const k of ['start', 'update', 'draw']) assert.equal(typeof balloons[k], 'function');
  assert.ok(balloons.title && balloons.hint && balloons.duration > 0);
});

test('balloons: a hand touching a balloon sends it up and scores 1 for that kid', () => {
  const a = kid({ id: 1, hands: [{ x: 960, y: 560 }] });
  const b = kid({ id: 2 });
  const g = makeG([a, b]);
  balloons.start(g);
  balloons.items = [balloon()];
  run(g, 1 / 60);
  assert.ok(balloons.items[0].vy < 0, 'going up');
  assert.deepEqual([a.score, b.score], [1, 0]);
});

test('balloons: a hand resting in a balloon is one tap, not one per frame', () => {
  const a = kid({ hands: [{ x: 960, y: 500 }] });
  const g = makeG([a]);
  balloons.start(g);
  balloons.items = [balloon({ vy: 0 })];
  balloons.items[0].y = 500;
  run(g, 0.1);
  assert.equal(a.score, 1);
});

test('balloons: the head can bounce a balloon too', () => {
  const px = Array.from({ length: 33 }, () => far);
  px[0] = { x: 960, y: 590 };
  const a = kid({ px });
  const g = makeG([a]);
  balloons.start(g);
  balloons.items = [balloon()];
  run(g, 1 / 60);
  assert.equal(a.score, 1);
});

test('balloons: a balloon out of reach falls slowly and pops on the floor, then comes back', () => {
  const g = makeG([kid()]);
  balloons.start(g);
  balloons.items = [balloon({ y: 300, vy: 0 })];
  balloons.elapsed = 0;
  run(g, 1);
  assert.equal(balloons.items.length, 1, 'still falling after 1 s: it is floaty');
  assert.ok(balloons.items[0].vy <= 240 + 1e-9, 'air drag caps the fall speed');
  run(g, 4);
  assert.equal(balloons.items.length, 0, 'popped on the floor');
  assert.ok(balloons.air < 3, 'the in-the-air timer reset when it landed');
  assert.equal(g.levelEnd, null, 'a drop never ends the level');
  run(g, 3);
  assert.ok(balloons.items.length >= 1, 'came back');
});

test('balloons: a tap pushes the balloon away from the side it was hit on, plus the swing', () => {
  const b = balloon();
  assert.ok(tap(b, 900, 0, 1).vx > 0, 'hit on its left side: goes right');
  assert.ok(tap(b, 1020, 0, 1).vx < 0, 'hit on its right side: goes left');
  assert.ok(tap(b, 960, 800, 1).vx > tap(b, 960, 0, 1).vx, 'a swing to the right sends it further right');
  assert.ok(tap(b, 960, 0, 1).vy < 0, 'always up');
});

test('balloons: balloons bounce off the sides and stay on screen', () => {
  const g = makeG([kid()]);
  balloons.start(g);
  balloons.items = [balloon({ x: 100, vx: -2000, y: 300 })];
  run(g, 0.5);
  const b = balloons.items[0];
  assert.ok(b.x >= b.r && b.vx >= 0);
});

test('balloons: more balloons are added over time, capped by the number of kids', () => {
  assert.equal(balloonTarget(0, 1), 1);
  assert.equal(balloonTarget(7, 1), 2);
  assert.equal(balloonTarget(100, 1), 3, 'at least 3 even for one kid');
  assert.equal(balloonTarget(100, 3), 6, '2 per kid');
  const g = makeG([kid()]);
  balloons.start(g);
  run(g, 15);
  // nobody is tapping, so some may be on the floor waiting; the total never passes the target
  assert.ok(balloons.items.length + balloons.respawns.length <= balloonTarget(15, 1));
});

test('balloons: keeping everything up for 5 s earns the team a point', () => {
  const g = makeG([kid()]);
  balloons.start(g);
  balloons.items = [];
  balloons.elapsed = -1000; // no new balloons for this test
  run(g, 5.1);
  assert.equal(g.team.score, 1);
});

test('balloons: survives a long run with no players, 3 players and players coming and going', () => {
  const g = makeG([]);
  balloons.start(g);
  for (let i = 0; i < 60 * 50; i++) {
    g.now += 1 / 60;
    if (i === 300) g.players = [kid({ id: 1 }), kid({ id: 2 }), kid({ id: 3 })];
    if (i === 2000) g.players = [g.players[0]];
    for (const p of g.players) p.hands = [{ x: 960 + 600 * Math.sin(g.now + p.id), y: 300 + 300 * Math.sin(g.now * 1.7 + p.id) }];
    balloons.update(g, 1 / 60);
  }
  assert.equal(g.levelEnd, null);
});
