import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ease, EASE } from '../../src/ease.js';

test('three misses in a row ease the game one step', () => {
  const e = new Ease();
  e.miss(1);
  e.miss(2);
  assert.equal(e.factor, 1);
  e.miss(3);
  assert.equal(e.factor, 1 - EASE.step);
});

test('misses spread out over a long time do not ease it', () => {
  const e = new Ease();
  for (let t = 0; t < 60; t += EASE.window / 2 + 1) e.miss(t);
  assert.equal(e.factor, 1);
});

test('a team that mostly succeeds is not eased by a few misses', () => {
  const e = new Ease();
  for (let i = 0; i < 5; i++) e.hit(i * 0.5);
  e.miss(3);
  e.miss(3.5);
  e.miss(4);
  assert.equal(e.factor, 1);
});

test('easing stops at the minimum', () => {
  const e = new Ease();
  for (let t = 0; t < 100; t++) e.miss(t * 0.1);
  assert.equal(e.factor, EASE.min);
});

test('running out of hearts eases one step', () => {
  const e = new Ease();
  e.failedLevel(0);
  assert.equal(e.factor, 1 - EASE.step);
});

test('a long spell without points eases it, but only while someone is playing', () => {
  const e = new Ease();
  e.newLevel();
  for (let t = 0; t <= 60; t += 0.1) e.update(t, false); // nobody there
  assert.equal(e.factor, 1);
  e.newLevel();
  for (let t = 60; t <= 60 + EASE.drought + 0.5; t += 0.1) e.update(t, true);
  assert.equal(e.factor, 1 - EASE.step);
});

test('team points (dodging well) stop the no-points clock without counting as hits', () => {
  const e = new Ease();
  e.newLevel();
  for (let t = 0; t <= EASE.drought * 4; t += 0.1) {
    if (Math.round(t * 10) % 20 === 0) e.point(t);
    e.update(t, true);
  }
  assert.equal(e.factor, 1);
  assert.equal(e.hits.length, 0);
});

test('after a good spell it speeds back up to normal, not past it', () => {
  const e = new Ease();
  e.failedLevel(0);
  e.failedLevel(0);
  let t = 0;
  for (; t < EASE.recover - 1; t += 0.5) {
    e.hit(t);
    e.update(t, true);
  }
  assert.equal(e.factor, 1 - 2 * EASE.step); // not yet
  for (; t < 400; t += 0.5) {
    e.hit(t);
    e.update(t, true);
  }
  assert.equal(e.factor, 1);
});

test('reset goes back to normal speed', () => {
  const e = new Ease();
  e.failedLevel(0);
  e.reset();
  assert.equal(e.factor, 1);
});
