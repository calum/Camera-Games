// Join-by-arms-out lobby: start after 3s with exactly the kids whose arms are out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../src/lobby.js';

const kid = (id, airplane) => ({ id, pose: { airplane } });

// Run the lobby for `seconds` at 30fps with a function giving who is visible at each moment.
function run(lobby, seconds, players, start = 0) {
  let result = null;
  const dt = 1 / 30;
  for (let t = start; t < start + seconds; t += dt) {
    const ps = typeof players === 'function' ? players(t) : players;
    result = lobby.update(ps, t, dt) ?? result;
    if (result) return { result, t };
  }
  return { result, t: start + seconds };
}

test('nobody visible, or nobody with arms out: never starts', () => {
  const l = new Lobby();
  assert.equal(run(l, 10, []).result, null);
  assert.equal(run(new Lobby(), 10, [kid(1, false), kid(2, false)]).result, null);
});

test('one kid holding arms out for 3 seconds starts the game with that kid', () => {
  const { result, t } = run(new Lobby(), 5, [kid(1, true)]);
  assert.deepEqual(result, [1]);
  assert.ok(t >= 3 && t < 3.2, `started after about 3 seconds (t=${t.toFixed(2)})`);
});

test('does not start before 3 seconds', () => {
  assert.equal(run(new Lobby(), 2.9, [kid(1, true)]).result, null);
});

test('kids who did not put their arms out are left out', () => {
  const { result } = run(new Lobby(), 5, [kid(1, true), kid(2, false), kid(3, true)]);
  assert.deepEqual(result, [1, 3]);
});

test('everyone with arms out must hold: a newcomer joining at 2s restarts the countdown', () => {
  const l = new Lobby();
  const { result, t } = run(l, 10, (t) => [kid(1, true), kid(2, t >= 2)]);
  assert.deepEqual(result, [1, 2]);
  assert.ok(t >= 5 && t < 5.3, `fresh 3s after the newcomer joined (t=${t.toFixed(2)})`);
});

test('someone dropping their arms restarts the countdown for the rest, who start without them', () => {
  const l = new Lobby();
  const { result, t } = run(l, 10, (t) => [kid(1, true), kid(2, t < 2)]);
  assert.deepEqual(result, [1]);
  assert.ok(t > 5 && t < 5.6, `3s after the drop plus the flicker grace (t=${t.toFixed(2)})`);
});

test('brief tracking flicker (a few frames) does not reset the countdown', () => {
  const l = new Lobby();
  const { result, t } = run(l, 10, (t) => [kid(1, !(t > 1.5 && t < 1.7))]); // 0.2s dropout
  assert.deepEqual(result, [1]);
  assert.ok(t < 3.3, `countdown was not restarted (t=${t.toFixed(2)})`);
});

test('a kid walking out of view restarts the countdown', () => {
  const l = new Lobby();
  const { result, t } = run(l, 10, (t) => (t > 1 && t < 2 ? [] : [kid(1, true)]));
  assert.deepEqual(result, [1]);
  assert.ok(t > 4.9, `needed a full 3s after coming back (t=${t.toFixed(2)})`);
});

test('progress and seconds-left drive the on-screen countdown', () => {
  const l = new Lobby();
  run(l, 1.5, [kid(1, true)]);
  assert.ok(l.progress > 0.4 && l.progress < 0.6);
  assert.equal(l.secondsLeft, 2);
  assert.equal(l.isJoined(1), true);
  assert.equal(l.isJoined(2), false);
});

test('reset forgets everyone', () => {
  const l = new Lobby();
  run(l, 2, [kid(1, true)]);
  l.reset();
  assert.equal(l.progress, 0);
  assert.deepEqual(l.joined, []);
});

// ---- joining mid-game -------------------------------------------------------------------------------
import { lateJoin } from '../../src/lobby.js';

test('mid-game: a watcher who holds their arms out for 2 s joins; walking past does not', () => {
  const walker = { excluded: true, pose: { airplane: false } };
  for (let i = 0; i < 300; i++) assert.equal(lateJoin(walker, 1 / 30), false);
  assert.equal(walker.excluded, true, 'a passer-by never joins');

  const kid = { excluded: true, pose: { airplane: true } };
  let joinedAt = null;
  for (let i = 0; i < 90 && joinedAt === null; i++) if (lateJoin(kid, 1 / 30)) joinedAt = i / 30;
  assert.ok(joinedAt > 1.9 && joinedAt < 2.1, `joined after ~2 s (${joinedAt})`);
  assert.equal(kid.excluded, false);
});

test('mid-game: one glitchy frame does not reset a kid who is joining', () => {
  const kid = { excluded: true, pose: { airplane: true } };
  for (let i = 0; i < 45; i++) lateJoin(kid, 1 / 30);
  kid.pose.airplane = false;
  lateJoin(kid, 1 / 30);
  kid.pose.airplane = true;
  let n = 0;
  while (!lateJoin(kid, 1 / 30)) n++;
  assert.ok(n < 20, `only a little extra hold needed (${n} frames)`);
});

test('mid-game: players who are already playing are left alone', () => {
  const p = { excluded: false, pose: { airplane: true } };
  assert.equal(lateJoin(p, 5), false);
  assert.equal(p.excluded, false);
});
