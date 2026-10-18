// Level picker: hold a raised hand over a card until its ring fills.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Picker, pickerChoices, pickerLayout, pickingHands, cardAt, surprisePick } from '../../src/picker.js';
import { LEVELS } from '../../src/levels/index.js';

const W = 1920;
const H = 1080;
const rects = pickerLayout(LEVELS.length + 1, W, H, 1);
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// Run the picker at 30 fps; hands(t) gives the hand points at each moment. Returns the chosen card and when.
function run(picker, seconds, hands) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    const { chosen } = picker.update(rects, hands(t), dt);
    if (chosen >= 0) return { chosen, t };
  }
  return { chosen: -1, t: seconds };
}

test('there is a card for every level plus Surprise, and every level has a picture', () => {
  const choices = pickerChoices(LEVELS);
  assert.equal(choices.length, LEVELS.length + 1);
  assert.equal(choices.at(-1).kind, 'surprise');
  for (const L of LEVELS) assert.ok(L.icon, `${L.id} has an icon`);
});

test('the cards fit on screen, never overlap, and are big enough for a kid to aim at', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [1080, 1920], [800, 600]]) {
    const u = h / 1080;
    const rs = pickerLayout(LEVELS.length + 1, w, h, u);
    for (const r of rs) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `card inside ${w}x${h}`);
      assert.ok(r.w >= Math.min(w, h) * 0.14, `card big enough at ${w}x${h} (${r.w.toFixed(0)}px)`);
    }
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `cards ${i} and ${j} overlap at ${w}x${h}`);
      }
  }
});

test('holding a hand over a card chooses it after about 1.5 s (plus the short wait when the picker opens)', () => {
  const p = new Picker();
  const { chosen, t } = run(p, 5, () => [centre(rects[3])]);
  assert.equal(chosen, 3);
  assert.ok(t > 2.2 && t < 2.5, `chosen after ${t.toFixed(2)}s`);
});

test('no hand, or a hand between cards, never chooses anything', () => {
  assert.equal(run(new Picker(), 10, () => []).chosen, -1);
  const between = { x: (rects[0].x + rects[0].w + rects[1].x) / 2, y: H * 0.99 };
  assert.equal(cardAt(rects, between), -1);
  assert.equal(run(new Picker(), 10, () => [between]).chosen, -1);
});

test('tracking flicker does not reset the ring: the hand dropping out now and then only slows it down', () => {
  const p = new Picker();
  // the hand is lost for 2 frames in every 10
  let n = 0;
  const { chosen, t } = run(p, 8, () => (n++ % 10 < 8 ? [centre(rects[5])] : []));
  assert.equal(chosen, 5);
  assert.ok(t < 3.5, `still chosen quickly (${t.toFixed(2)}s)`);
});

test('taking the hand away drains the ring slowly, and moving to another card starts that one from empty', () => {
  const p = new Picker();
  run(p, 1.8, () => [centre(rects[0])]); // 0.8 s wait + 1 s of filling: ring two-thirds full
  const before = p.progress(0);
  assert.ok(before > 0.5 && before < 0.8, `filled to ${before.toFixed(2)}`);
  p.update(rects, [], 0.3);
  assert.ok(p.progress(0) > before - 0.15 && p.progress(0) < before, 'drains, but slowly');
  const { chosen, t } = run(p, 5, () => [centre(rects[1])]);
  assert.equal(chosen, 1);
  assert.ok(t > 1.4, `the new card needs its own full hold (${t.toFixed(2)}s)`);
});

test('two kids on two cards: the first ring to fill wins', () => {
  const p = new Picker();
  const { chosen } = run(p, 5, (t) => (t < 1.4 ? [centre(rects[2])] : [centre(rects[2]), centre(rects[7])]));
  assert.equal(chosen, 2);
});

test('a hand moving onto a card is reported once (for the sound and wiggle)', () => {
  const p = new Picker();
  assert.deepEqual(p.update(rects, [centre(rects[4])], 0.03).entered, [4]);
  assert.deepEqual(p.update(rects, [centre(rects[4])], 0.03).entered, []);
  p.update(rects, [], 0.03);
  assert.deepEqual(p.update(rects, [centre(rects[4])], 0.03).entered, [4]);
});

test('only raised hands choose: hands hanging at the sides do not count', () => {
  const kid = (handY) => ({ sh: { x: 500, y: 400 }, shoulderW: 100, hands: [{ x: 450, y: handY }, { x: 550, y: handY }, { x: 450, y: handY + 10 }, { x: 550, y: handY + 10 }] });
  assert.equal(pickingHands([kid(600)]).length, 0, 'hands down by the hips');
  assert.equal(pickingHands([kid(300)]).length, 4, 'hands up');
  assert.equal(pickingHands([kid(420)]).length, 4, 'hands at shoulder height (a little slack)');
  assert.equal(pickingHands([kid(300)]).filter((h) => h.tip).length, 2, 'one fingertip per hand is drawn');
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
  for (let k = 0; k < 50; k++) assert.ok(surprisePick(n, -1) < n);
});
