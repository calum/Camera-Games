import test from 'node:test';
import assert from 'node:assert/strict';
import { Calibration, playArea, shouldCalibrate, FULL_AREA, CAL } from '../../src/calibrate.js';
import { reachX, standX } from '../../src/levels/kit.js';
import { digSpan, pickColumn, COLS } from '../../src/levels/dig.js';
import { LEVELS } from '../../src/levels/index.js';

const W = 1920;
const kid = (id, x) => ({ id, cx: x * W, sh: { x: x * W, y: 400 }, hands: [{ x: x * W - 120, y: 500 }, { x: x * W + 120, y: 500 }] });

// Runs a calibration with kids whose positions (fractions of the width) come from fn(t); returns it when done.
function run(fn, { secs = 40, dt = 1 / 30 } = {}) {
  const c = new Calibration();
  for (let t = 0; t < secs && !c.finished; t += dt) c.update(fn(t, c), W, dt);
  return c;
}

// Walk from `from` towards `to` at `speed` (fractions of the width per second), then stop there.
const walk = (from, to, t, speed = 0.15) => (to < from ? Math.max(to, from - speed * t) : Math.min(to, from + speed * t));

test('a kid walks left until the sofa, then right until the wall: that is the play space', () => {
  let t0 = null;
  const c = run((t, cal) => {
    if (cal.phase === 'left') return [kid(1, walk(0.5, 0.3, t))];
    t0 ??= t;
    return [kid(1, walk(0.3, 0.8, t - t0))];
  });
  assert.equal(c.finished, true);
  assert.deepEqual(c.sides, { left: true, right: true });
  const a = c.area;
  assert.ok(Math.abs(a.x0 - 0.3) < 0.01 && Math.abs(a.x1 - 0.8) < 0.01, JSON.stringify(a));
  assert.ok(a.reach0 < a.x0 && a.reach1 > a.x1, 'hands reach a bit further than the body');
});

test('walking back across ground already found is not "stopping at the edge"', () => {
  // right phase: the kid is on the left and takes a while to cross back over the middle
  let t0 = null;
  const c = run((t, cal) => {
    if (cal.phase === 'left') return [kid(1, walk(0.5, 0.2, t, 0.3))];
    t0 ??= t;
    return [kid(1, walk(0.2, 0.75, t - t0, 0.06))]; // slow: ~5 s back to the middle
  });
  assert.ok(Math.abs(c.area.x1 - 0.75) < 0.01, `the right side is where the kid stopped, not the middle (${c.area.x1})`);
});

test('a kid already at the edge of the picture finishes that side straight away', () => {
  const c = new Calibration();
  for (let t = 0; t < CAL.minPhase + 0.2; t += 1 / 30) c.update([kid(1, 0.04)], W, 1 / 30);
  assert.equal(c.phase, 'right');
  assert.equal(c.sides.left, true);
});

test('a kid who started right against the obstacle is believed after a few seconds', () => {
  const c = new Calibration();
  let t = 0;
  for (; c.phase === 'left' && t < 20; t += 1 / 30) c.update([kid(1, 0.45)], W, 1 / 30);
  assert.ok(t >= CAL.stuck && t < CAL.giveUp, `took ${t.toFixed(1)} s`);
  assert.equal(c.sides.left, true);
});

test('nobody in view: it gives up and keeps the whole width, it never waits for ever', () => {
  const c = run(() => []);
  assert.equal(c.finished, true);
  assert.deepEqual(c.area, FULL_AREA);
});

test('a kid who keeps running about still finishes, and the unmeasured side stays open', () => {
  const c = run((t) => [kid(1, 0.5 + 0.3 * Math.sin(t * 3) * Math.min(1, t / 20))]); // ever wider, never settles
  assert.equal(c.finished, true);
  assert.ok(c.t <= CAL.doneTime + 0.1);
});

test('several kids: the space is everything any of them reached', () => {
  let t0 = null;
  const c = run((t, cal) => {
    if (cal.phase === 'left') return [kid(1, walk(0.4, 0.15, t)), kid(2, walk(0.6, 0.45, t))];
    t0 ??= t;
    return [kid(1, walk(0.15, 0.5, t - t0)), kid(2, walk(0.45, 0.7, t - t0))];
  });
  assert.ok(Math.abs(c.area.x0 - 0.15) < 0.01 && Math.abs(c.area.x1 - 0.7) < 0.01, JSON.stringify(c.area));
});

test('the play space is never tiny, unmeasured sides are open, and a skip keeps what was measured', () => {
  const tiny = playArea(0.5, 0.52, 0.45, 0.57, { left: true, right: true });
  assert.ok(tiny.x1 - tiny.x0 >= CAL.minWidth - 1e-9);
  const edge = playArea(0.0, 0.05, 0, 0.1, { left: true, right: true });
  assert.ok(edge.x0 >= 0 && edge.x1 <= 1 && edge.x1 - edge.x0 >= CAL.minWidth - 1e-9);
  assert.deepEqual(playArea(0.3, 0.6, 0.25, 0.65, { left: true, right: false }), { x0: 0.3, x1: 1, reach0: 0.21, reach1: 1 });
  const c = new Calibration();
  c.skip();
  assert.equal(c.finished, true);
  assert.deepEqual(c.area, FULL_AREA);
});

test('it runs on every start unless ?nocal or ?level=', () => {
  assert.equal(shouldCalibrate(new URLSearchParams('')), true);
  assert.equal(shouldCalibrate(new URLSearchParams('mouse')), true);
  assert.equal(shouldCalibrate(new URLSearchParams('nocal')), false);
  assert.equal(shouldCalibrate(new URLSearchParams('level=dodge')), false);
});

test('levels: without a play space everything is placed as before; with one, inside it', () => {
  const g = { W, area: null };
  assert.equal(reachX(g, 0.5), W / 2);
  assert.equal(standX(g, 0.1), W * 0.1);
  g.area = { x0: 0.4, x1: 0.9, reach0: 0.35, reach1: 0.95 };
  assert.equal(standX(g, 0), 0.4 * W);
  assert.equal(standX(g, 1), 0.9 * W);
  assert.equal(reachX(g, 0), 0.35 * W);
  assert.equal(reachX(g, 1), 0.95 * W);
});

test('dig: the columns fill the screen without a play space, and sit over it with one', () => {
  assert.deepEqual(digSpan(), { left: 0, width: 1 });
  const s = digSpan({ x0: 0.4, x1: 0.9, reach0: 0.35, reach1: 0.95 });
  assert.ok(s.left >= 0 && s.left + s.width <= 1 + 1e-9);
  // a kid at either edge of the space is in an end column, in its middle part
  const col = (x) => pickColumn((x - s.left) * W, s.width * W);
  assert.equal(col(0.4), 0);
  assert.equal(col(0.9), COLS - 1);
  // a squeezed space still gets wide columns
  assert.ok(digSpan({ x0: 0.1, x1: 0.25, reach0: 0.05, reach1: 0.3 }).width >= 0.6 - 1e-9);
});

// Plays a level with a kid wandering inside the play space and checks where the things to touch or stand in went.
function placements(id, area, secs = 60) {
  const level = LEVELS.find((l) => l.id === id);
  const u = 1;
  const p = { id: 1, present: true, excluded: false, cx: 1100, sh: { x: 1100, y: 400 }, hip: { x: 1100, y: 600 }, shoulderW: 120, torso: 200, hands: [{ x: 1000, y: 300 }], circles: [{ x: 1100, y: 300, r: 40 }], px: Array.from({ length: 33 }, () => ({ x: 1100, y: 500 })), pose: {}, lastJump: -9, jumps: 0, score: 0, motion: 0 };
  const g = {
    W, H: 1080, u, now: 0, diff: 1, ease: 1, round: 0, fx: false, area, players: [p], particles: [],
    team: { score: 0, hearts: 99, maxHearts: 99 }, level, levelEnd: null,
    activePlayers: () => [p], score() {}, burst() {}, miss() {}, endLevel() {},
  };
  level.start(g);
  const xs = [];
  for (let t = 0; t < secs; t += 1 / 30) {
    g.now = t;
    level.update(g, 1 / 30);
    for (const it of level.items ?? []) xs.push(it.x0 ?? it.x);
    if (level.big) xs.push(level.big.gapX);
  }
  return xs;
}

test('bubbles, stars, balloons and the safe gap only go where the kids can get to', () => {
  const area = { x0: 0.45, x1: 0.85, reach0: 0.4, reach1: 0.9 };
  for (const id of ['bubbles', 'meteor', 'balloons', 'avalanche']) {
    // one giant boulder per play: play avalanche a few times to see several gaps
    const xs = id === 'avalanche' ? Array.from({ length: 12 }, () => placements(id, area, 45)).flat() : placements(id, area, 30);
    assert.ok(xs.length > 0, `${id} placed something`);
    const out = xs.filter((x) => x < area.reach0 * W - 1 || x > area.reach1 * W + 1);
    assert.deepEqual(out.slice(0, 3), [], `${id}: nothing outside the play space`);
  }
});
