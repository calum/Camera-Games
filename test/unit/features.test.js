// Unit tests for turning a skeleton into game signals (hands, body circles, jump, poses).
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures } from '../../src/tracker.js';

// A kid standing in the middle of a 1920x1080 screen: torso 200px, shoulders 100px wide.
function standing(over = {}) {
  const px = Array.from({ length: 33 }, () => ({ x: 960, y: 540 }));
  const set = (i, x, y) => (px[i] = { x, y });
  set(0, 960, 200); // nose
  set(11, 910, 300); set(12, 1010, 300); // shoulders
  set(23, 920, 500); set(24, 1000, 500); // hips
  set(25, 920, 700); set(26, 1000, 700); // knees
  set(27, 920, 900); set(28, 1000, 900); // ankles
  set(15, 900, 450); set(16, 1020, 450); // wrists (hanging down)
  set(19, 900, 470); set(20, 1020, 470); // index fingertips
  for (const [i, [x, y]] of Object.entries(over)) set(Number(i), x, y);
  return { px, jumps: 0, lastJump: -99, wasJump: false };
}

test('derives body measurements relative to the kid', () => {
  const p = standing();
  computeFeatures(p, 1);
  assert.equal(Math.round(p.shoulderW), 100);
  assert.equal(Math.round(p.torso), 200);
  assert.equal(p.cx, 960);
  assert.equal(p.hands.length, 4);
  assert.equal(p.circles.length, 5);
  assert.ok(p.circles.every((c) => c.r >= 35), 'body circles have a minimum size so tiny kids are still hittable');
});

test('standing still is not a jump and not any pose', () => {
  const p = standing();
  computeFeatures(p, 1);
  computeFeatures(p, 1.03);
  assert.equal(p.jumps, 0);
  assert.equal(p.lastJump, -99);
  assert.deepEqual(p.pose, { armsUp: false, airplane: false, handsHead: false });
});

test('hips rising quickly counts as exactly one jump, even across several frames', () => {
  const p = standing();
  computeFeatures(p, 1); // sets the baseline
  const airborne = standing({ 23: [920, 430], 24: [1000, 430] });
  p.px = airborne.px;
  computeFeatures(p, 1.03);
  computeFeatures(p, 1.06); // still in the air
  assert.equal(p.jumps, 1);
  assert.equal(p.lastJump, 1.06);
  // landing and jumping again is a second jump
  p.px = standing().px;
  computeFeatures(p, 1.3);
  p.px = airborne.px;
  computeFeatures(p, 1.5);
  assert.equal(p.jumps, 2);
});

test('crouching or walking closer is not a jump', () => {
  const p = standing();
  computeFeatures(p, 1);
  p.px = standing({ 23: [920, 600], 24: [1000, 600] }).px; // hips go down
  computeFeatures(p, 1.03);
  assert.equal(p.jumps, 0);
});

test('a slow rise is absorbed by the baseline instead of triggering a jump', () => {
  const p = standing();
  computeFeatures(p, 0);
  // hips drift up ~1px per frame for 4 seconds (e.g. stepping back)
  for (let f = 1; f <= 120; f++) {
    p.px = standing({ 23: [920, 500 - f * 0.5], 24: [1000, 500 - f * 0.5] }).px;
    computeFeatures(p, f / 30);
  }
  assert.equal(p.jumps, 0);
});

test('arms up pose', () => {
  const p = standing({ 15: [900, 20], 16: [1020, 20], 19: [900, 0], 20: [1020, 0] });
  computeFeatures(p, 1);
  assert.equal(p.pose.armsUp, true);
  assert.equal(p.pose.airplane, false);
});

test('airplane pose (arms straight out, opposite sides)', () => {
  const p = standing({ 15: [700, 300], 16: [1220, 300] });
  computeFeatures(p, 1);
  assert.equal(p.pose.airplane, true);
  assert.equal(p.pose.armsUp, false);
  assert.equal(p.pose.handsHead, false);
});

test('airplane needs both arms: one arm out is not enough', () => {
  const p = standing({ 15: [700, 300] });
  computeFeatures(p, 1);
  assert.equal(p.pose.airplane, false);
});

test('hands on head pose', () => {
  const p = standing({ 15: [925, 215], 16: [995, 215] });
  computeFeatures(p, 1);
  assert.equal(p.pose.handsHead, true);
  assert.equal(p.pose.armsUp, false);
});

test('poses scale with body size: a small, far-away kid can still do them', () => {
  // everything shrunk to 40% around the same centre
  const base = standing({ 15: [700, 300], 16: [1220, 300] });
  const small = base.px.map((q) => ({ x: 960 + (q.x - 960) * 0.4, y: 540 + (q.y - 540) * 0.4 }));
  const p = { px: small, jumps: 0, lastJump: -99, wasJump: false };
  computeFeatures(p, 1);
  assert.equal(p.pose.airplane, true);
});

test('skipJump option leaves jump state alone (used by mouse mode)', () => {
  const p = standing();
  computeFeatures(p, 1, { skipJump: true });
  p.px = standing({ 23: [920, 300], 24: [1000, 300] }).px;
  computeFeatures(p, 1.03, { skipJump: true });
  assert.equal(p.jumps, 0);
});
