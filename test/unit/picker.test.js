// Level picker carousel: wave a hand to the side to scroll, both arms up to play the game in the middle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Carousel, pickerChoices, carouselLayout, carouselCardAt, handsOut, surprisePick } from '../../src/picker.js';
import { LEVELS } from '../../src/levels/index.js';

// A kid standing at x=500 with shoulders 100 px wide (so 1 shoulder width = 100 px). Hands are given as
// [x, y] offsets from the middle of the shoulders, in shoulder widths (negative y = up).
const S = 100;
function kid(id, left, right, armsUp = false) {
  const sh = { x: 500, y: 400 };
  const at = ([dx, dy]) => ({ x: sh.x + dx * S, y: sh.y + dy * S });
  const px = Array.from({ length: 33 }, () => ({ ...sh }));
  px[0] = { x: 500, y: 300 }; // nose, 1 shoulder width above the shoulders
  const l = at(left);
  const r = at(right);
  return /** @type {any} */ ({ id, sh, shoulderW: S, px, hands: [l, r, l, r], pose: { armsUp } });
}
const DOWN_L = [-0.3, 1.8]; // hands hanging by the hips
const DOWN_R = [0.3, 1.8];
const OUT_L = [-1.6, 0]; // straight out to the side at shoulder height
const OUT_R = [1.6, 0];
const UP_L = [-0.4, -2.2]; // straight up
const UP_R = [0.4, -2.2];

// Run at 30 fps for `seconds`; players(t) gives the kids at each moment. Returns every step and the first choice.
function run(c, seconds, players, start = 0) {
  const dt = 1 / 30;
  const steps = [];
  for (let t = start; t < start + seconds; t += dt) {
    const { step, chosen } = c.update(players(t), dt);
    if (step) steps.push(step);
    if (chosen >= 0) return { steps, chosen, t };
  }
  return { steps, chosen: -1, t: start + seconds };
}

test('there is a card for every level plus Surprise, and every level has a picture', () => {
  const choices = pickerChoices(LEVELS);
  assert.equal(choices.length, LEVELS.length + 1);
  assert.equal(choices.at(-1).kind, 'surprise');
  for (const L of LEVELS) assert.ok(L.icon, `${L.id} has an icon`);
});

test('which side a hand is out to: right, left, both (airplane), and hands down or up count as neither', () => {
  const none = { left: false, right: false };
  assert.deepEqual(handsOut(kid(1, DOWN_L, OUT_R), none), { left: false, right: true });
  assert.deepEqual(handsOut(kid(1, OUT_L, DOWN_R), none), { left: true, right: false });
  assert.deepEqual(handsOut(kid(1, OUT_L, OUT_R), none), { left: true, right: true });
  assert.deepEqual(handsOut(kid(1, DOWN_L, DOWN_R), none), none);
  assert.deepEqual(handsOut(kid(1, UP_L, UP_R), none), none, 'arms straight up are not a wave');
  assert.deepEqual(handsOut(kid(1, [-1.2, -2.2], [1.2, -2.2]), none), none, 'nor are arms up in a wide V');
  assert.deepEqual(handsOut(kid(1, DOWN_L, [1.8, 1.8]), none), none, 'nor a hand low down to the side');
});

test('a hand that is out stays out while it waves about, until it comes well back in', () => {
  const out = { left: false, right: true };
  assert.equal(handsOut(kid(1, DOWN_L, [0.8, 0]), out).right, true, 'waving inwards a bit');
  assert.equal(handsOut(kid(1, DOWN_L, [0.8, 0]), { left: false, right: false }).right, false, 'but not enough to start out there');
  assert.equal(handsOut(kid(1, DOWN_L, [0.4, 0]), out).right, false, 'back in front of the body');
});

test('waving the right hand out once scrolls one card right; the left hand one card left', () => {
  const c = new Carousel({ n: 12 });
  const wave = (side) => (t) => [kid(1, side < 0 && t < 0.5 ? OUT_L : DOWN_L, side > 0 && t < 0.5 ? OUT_R : DOWN_R)];
  assert.deepEqual(run(c, 1, wave(1)).steps, [1]);
  assert.equal(c.index, 1);
  assert.deepEqual(run(c, 1, wave(1)).steps, [1]);
  assert.deepEqual(run(c, 1, wave(-1)).steps, [-1]);
  assert.equal(c.index, 1);
});

test('the list wraps round both ways', () => {
  const c = new Carousel({ n: 5 });
  c.step(-1);
  assert.equal(c.index, 4);
  c.step(2);
  assert.equal(c.index, 1);
});

test('holding a hand out keeps scrolling, slowly', () => {
  const c = new Carousel({ n: 12 });
  const { steps } = run(c, 3, () => [kid(1, DOWN_L, OUT_R)]);
  // one straight away, then after 1 s, then every 0.7 s: about 4 in 3 s
  assert.ok(steps.length >= 3 && steps.length <= 5, `${steps.length} steps in 3 s`);
  assert.ok(steps.every((s) => s === 1));
});

test('airplane arms (the join gesture) do not scroll, even when one arm rises a moment before the other', () => {
  const c = new Carousel({ n: 12 });
  const { steps, chosen } = run(c, 3, (t) => [kid(1, t < 0.1 ? DOWN_L : OUT_L, OUT_R)]);
  assert.deepEqual(steps, []);
  assert.equal(chosen, -1);
  assert.equal(c.index, 0);
});

test('both arms up for about a second plays the game in the middle', () => {
  const c = new Carousel({ n: 12 });
  c.reset(4);
  run(c, 1, () => [kid(1, DOWN_L, DOWN_R)]); // standing there first
  const { chosen, t } = run(c, 3, () => [kid(1, UP_L, UP_R, true)], 1);
  assert.equal(chosen, 4);
  assert.ok(t - 1 > 0.9 && t - 1 < 1.2, `took ${(t - 1).toFixed(2)} s`);
});

test('arms up already in the air when the picker opens (cheering at the end of a level) does not play anything', () => {
  const c = new Carousel({ n: 12 });
  assert.equal(run(c, 4, () => [kid(1, UP_L, UP_R, true)]).chosen, -1, 'kept up the whole time');
  // ...but once they have put their arms down, arms up works
  run(c, 0.3, () => [kid(1, DOWN_L, DOWN_R)]);
  assert.equal(run(c, 2, () => [kid(1, UP_L, UP_R, true)]).chosen, 0);
});

test('tracking flicker does not reset the arms-up ring: arms dropping out now and then only slows it', () => {
  const c = new Carousel({ n: 12 });
  run(c, 1, () => [kid(1, DOWN_L, DOWN_R)]);
  let n = 0;
  const { chosen, t } = run(c, 4, () => [n++ % 10 < 8 ? kid(1, UP_L, UP_R, true) : kid(1, DOWN_L, DOWN_R)], 1);
  assert.equal(chosen, 0);
  assert.ok(t - 1 < 2, `still quick (${(t - 1).toFixed(2)} s)`);
});

test('scrolling restarts the ring, so a game that only just slid into the middle is not played by accident', () => {
  const c = new Carousel({ n: 12 });
  run(c, 1, () => [kid(1, DOWN_L, DOWN_R)]);
  run(c, 0.7, () => [kid(1, UP_L, UP_R, true)], 1);
  assert.ok(c.progress > 0.5);
  c.step(1);
  assert.equal(c.progress, 0);
});

test('any playing kid can scroll or play; two kids waving opposite ways on the same frame cancel out', () => {
  const c = new Carousel({ n: 12 });
  const a = (t) => kid(1, DOWN_L, t < 0.5 ? OUT_R : DOWN_R);
  const b = (t) => ({ ...kid(2, t < 0.5 ? OUT_L : DOWN_L, DOWN_R), id: 2 });
  const { steps } = run(c, 1, (t) => [a(t), b(t)]);
  assert.equal(c.index, 0, `net nothing (${steps})`);
  run(c, 1, () => [kid(1, DOWN_L, DOWN_R), { ...kid(2, DOWN_L, DOWN_R), id: 2 }]);
  assert.equal(run(c, 2, () => [kid(1, DOWN_L, DOWN_R), { ...kid(2, UP_L, UP_R, true), id: 2 }]).chosen, 0);
});

test('layout: the middle card is the biggest, at the top centre, with smaller neighbours either side, all on screen', () => {
  for (const [W, H] of [[1920, 1080], [1280, 720], [1080, 1920]]) {
    const cards = carouselLayout(12, 3, W, H);
    const mid = cards.find((c) => c.off === 0);
    assert.equal(mid.i, 3);
    assert.equal(cards.at(-1), mid, 'drawn last, on top');
    assert.ok(Math.abs(mid.rect.x + mid.rect.w / 2 - W / 2) < 1, 'centred');
    assert.ok(mid.rect.y + mid.rect.h <= H * 0.46, 'in the top band, so the kids can see themselves under it');
    const prev = cards.find((c) => c.off === -1);
    const next = cards.find((c) => c.off === 1);
    assert.equal(prev.i, 2);
    assert.equal(next.i, 4);
    assert.ok(prev.rect.x + prev.rect.w / 2 < W / 2 && next.rect.x + next.rect.w / 2 > W / 2);
    assert.ok(next.rect.w < mid.rect.w * 0.7);
    for (const c of [prev, mid, next]) assert.ok(c.rect.x >= 0 && c.rect.x + c.rect.w <= W, `card ${c.i} on screen at ${W}x${H}`);
  }
  // wraps: card 0 in the middle has the last card on its left
  assert.equal(carouselLayout(12, 0, 1920, 1080).find((c) => c.off === -1).i, 11);
  // a short list never shows the same card twice
  const two = carouselLayout(3, 0, 1920, 1080).map((c) => c.i);
  assert.equal(new Set(two).size, two.length);
});

test('tapping: the middle card wins where cards overlap; empty space is nothing', () => {
  const cards = carouselLayout(12, 0, 1920, 1080);
  const mid = cards.find((c) => c.off === 0).rect;
  assert.equal(carouselCardAt(cards, { x: mid.x + 5, y: mid.y + mid.h / 2 }).i, 0);
  const next = cards.find((c) => c.off === 1).rect;
  assert.equal(carouselCardAt(cards, { x: next.x + next.w / 2, y: next.y + next.h / 2 }).i, 1);
  assert.equal(carouselCardAt(cards, { x: 960, y: 1070 }), null);
});

test('Surprise never picks the level just played, and can pick every other one', () => {
  const n = LEVELS.length;
  for (let last = 0; last < n; last++) {
    const seen = new Set();
    for (let k = 0; k < 200; k++) seen.add(surprisePick(n, last, () => k / 200));
    assert.ok(!seen.has(last), `not ${last} again`);
    assert.equal(seen.size, n - 1);
  }
  assert.equal(surprisePick(1, 0), 0);
});
