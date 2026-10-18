// Who is who: dogs and passers-by must not become players, a kid who steps out and back keeps their
// colour and score, and nothing switches instantly. Pure logic, no camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { People, isUpright, lookDistance, DEFAULTS } from '../../src/people.js';

// A standing person: head over shoulders over hips. cx in px, scale = shoulder width.
function person(cx, { shoulderW = 120, top = 300 } = {}) {
  const px = Array.from({ length: 33 }, () => ({ x: cx, y: top + 100 }));
  const set = (i, x, y) => (px[i] = { x, y });
  set(0, cx, top);
  set(11, cx - shoulderW / 2, top + 60);
  set(12, cx + shoulderW / 2, top + 60);
  set(23, cx - shoulderW * 0.35, top + 60 + shoulderW * 1.5);
  set(24, cx + shoulderW * 0.35, top + 60 + shoulderW * 1.5);
  set(25, cx - shoulderW * 0.35, top + 60 + shoulderW * 2.8);
  set(26, cx + shoulderW * 0.35, top + 60 + shoulderW * 2.8);
  return px;
}
// A dog-shaped "skeleton": the model sometimes fits a person to a four-legged pet: hips level with the
// shoulders, head at shoulder height.
function dog(cx) {
  const px = person(cx, { shoulderW: 90 });
  const y = 600;
  px[0] = { x: cx - 80, y };
  px[11] = { x: cx - 45, y };
  px[12] = { x: cx + 45, y };
  px[23] = { x: cx + 120, y: y + 5 };
  px[24] = { x: cx + 130, y: y - 5 };
  return px;
}
const det = (px, look = null) => ({ px, vis: px.map(() => 0.9), look });
const RED = [0.9, 0.1, 0.1, 0.2, 0.2, 0.6];
const BLUE = [0.1, 0.2, 0.9, 0.2, 0.2, 0.6];

// Run `people` for `seconds` at 30 fps with the same detections; returns the ids matched on the last frame.
function run(people, dets, from, seconds, step = 1 / 30) {
  let ids = [];
  for (let t = from; t < from + seconds; t += step) {
    ids = people.match(dets, t).map(([p]) => p.id);
    people.tick(t);
  }
  return ids;
}

test('a standing person is upright, a four-legged shape is not', () => {
  assert.equal(isUpright(person(500)), true);
  assert.equal(isUpright(person(500, { shoulderW: 40 })), true, 'a small kid is still upright');
  assert.equal(isUpright(dog(500)), false);
});

test('a new person is on probation for a moment, then becomes a player', () => {
  const people = new People();
  assert.deepEqual(run(people, [det(person(500))], 0, 0.3), [], 'not a player after 0.3 s');
  assert.deepEqual(run(people, [det(person(500))], 0.3, 0.3), [1], 'a player after ~0.5 s');
  assert.equal(people.players[0].isNew, true);
});

test('a body that flickers for a few frames (a dog running past, a ghost) never becomes a player', () => {
  const people = new People();
  // appears for 5 frames, gone for 0.5 s, appears for 5 frames again, repeatedly
  let t = 0;
  for (let burst = 0; burst < 6; burst++) {
    for (let i = 0; i < 5; i++, t += 1 / 30) people.match([det(person(500))], t), people.tick(t);
    for (let i = 0; i < 15; i++, t += 1 / 30) people.match([], t), people.tick(t);
  }
  assert.equal(people.players.length, 0);
});

test('a dog-shaped detection never becomes a player however long it stays', () => {
  const people = new People();
  assert.deepEqual(run(people, [det(dog(500))], 0, 3), []);
  assert.equal(people.players.length, 0);
});

test('a player keeps their id and colour while they move', () => {
  const people = new People();
  run(people, [det(person(500))], 0, 1);
  let ids = [];
  for (let t = 1, x = 500; t < 3; t += 1 / 30, x += 4) ids = people.match([det(person(x))], t).map(([p]) => p.id), people.tick(t);
  assert.deepEqual(ids, [1]);
  assert.equal(people.players.length, 1);
});

test('two kids are two players, and swapping sides does not swap them', () => {
  const people = new People();
  run(people, [det(person(400)), det(person(900))], 0, 1);
  const [a, b] = people.players;
  assert.equal(people.players.length, 2);
  assert.notEqual(a.color, b.color);
  // they walk past each other over a second
  for (let t = 1, i = 0; i <= 30; t += 1 / 30, i++) {
    const k = i / 30;
    const pairs = people.match([det(person(400 + 500 * k)), det(person(900 - 500 * k))], t);
    people.tick(t);
    if (i === 30) assert.deepEqual(pairs.map(([p]) => p.id).sort(), [a.id, b.id]);
  }
});

test('a kid who steps out of view and comes back where they left keeps their score and colour', () => {
  const people = new People();
  run(people, [det(person(500))], 0, 1);
  const kid = people.players[0];
  kid.score = 7;
  run(people, [], 1, 3); // gone for 3 s: well past the 0.6 s dropout
  assert.equal(kid.present, false);
  assert.equal(people.players.length, 1, 'still remembered');
  const ids = run(people, [det(person(560))], 4, 0.1);
  assert.deepEqual(ids, [kid.id], 'back at once, no probation');
  assert.equal(kid.score, 7);
  assert.equal(kid.present, true);
});

test('a kid who comes back somewhere else is recognised by their look', () => {
  const people = new People();
  run(people, [det(person(300), RED)], 0, 1);
  const kid = people.players[0];
  run(people, [], 1, 3);
  const ids = run(people, [det(person(1100), RED)], 4, 0.1);
  assert.deepEqual(ids, [kid.id]);
});

test('a different person standing where a lost kid was is NOT mistaken for them', () => {
  const people = new People();
  run(people, [det(person(500), RED)], 0, 1);
  const kid = people.players[0];
  run(people, [], 1, 3);
  const ids = run(people, [det(person(500), BLUE)], 4, 1);
  assert.equal(ids.length, 1);
  assert.notEqual(ids[0], kid.id, 'the blue person is a new player');
  assert.notEqual(people.players.find((p) => p.id === ids[0]).color, kid.color, 'and gets their own colour');
});

test('a lost kid is forgotten after a while and their colour is freed', () => {
  const people = new People({ forget: 5 });
  run(people, [det(person(500))], 0, 1);
  run(people, [], 1, 6);
  assert.equal(people.players.length, 0);
  run(people, [det(person(500))], 7, 1);
  assert.equal(people.players[0].slot, 0);
});

test('presence survives a 0.5 s tracking dropout', () => {
  const people = new People();
  run(people, [det(person(500))], 0, 1);
  const kid = people.players[0];
  run(people, [], 1, 0.5);
  assert.equal(kid.present, true);
  run(people, [], 1.5, 0.3);
  assert.equal(kid.present, false);
});

test('lookDistance: identical looks are 0, unknown looks are never a match', () => {
  assert.equal(lookDistance(RED, RED), 0);
  assert.ok(lookDistance(RED, BLUE) > DEFAULTS.lookDiff);
  assert.equal(lookDistance(null, RED), Infinity);
  assert.equal(lookDistance(RED, [1, 2]), Infinity);
});

test('a kid with no look signature can still come back by position', () => {
  const people = new People();
  run(people, [det(person(500))], 0, 1);
  const kid = people.players[0];
  run(people, [], 1, 2);
  assert.deepEqual(run(people, [det(person(520))], 3, 0.1), [kid.id]);
});

test('on a slow device (tracking at 2 frames a second) kids still get in and do not flicker', () => {
  const people = new People();
  const ids = run(people, [det(person(500))], 0, 3, 0.5);
  assert.deepEqual(ids, [1], 'became a player');
  const kid = people.players[0];
  // between two tracked frames, half a second apart, the kid stays present
  people.match([det(person(500))], 3);
  people.tick(3.45);
  assert.equal(kid.present, true);
});
