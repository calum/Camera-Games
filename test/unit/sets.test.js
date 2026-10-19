// Game sets: the cards the picker opens on, each playing a few levels in a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETS, setPlaylist, setPictures } from '../../src/levels/sets.js';
import { setChoices } from '../../src/picker.js';
import { LEVELS } from '../../src/levels/index.js';

test('the picker opens on the sets, Party mix first and "Pick your game" last', () => {
  const choices = setChoices(SETS);
  assert.equal(choices.length, SETS.length + 1);
  assert.equal(choices[0].kind === 'set' && choices[0].set.id, 'party');
  assert.equal(choices.at(-1).kind, 'all');
});

test('every level a set names exists, and every level is in a set besides Party mix', () => {
  const ids = new Set(LEVELS.map((L) => L.id));
  for (const s of SETS) for (const id of s.levels ?? []) assert.ok(ids.has(id), `${s.id} names a level called ${id}`);
  for (const L of LEVELS) assert.ok(SETS.some((s) => s.levels?.includes(L.id)), `${L.id} is in a set (src/levels/sets.js)`);
  for (const s of SETS) {
    assert.ok(s.icon && s.title && s.color, `${s.id} has an icon, a title and a colour`);
    assert.equal(new Set(setPlaylist(s, LEVELS)).size, setPlaylist(s, LEVELS).length, `${s.id} plays each level once`);
    assert.ok(setPlaylist(s, LEVELS).length >= 2, `${s.id} plays a few levels`);
  }
});

test('a fixed set plays its levels in its order', () => {
  const set = { id: 't', title: 'T', icon: '*', color: '#fff', levels: ['dodge', 'nope', 'bubbles'] };
  assert.deepEqual(setPlaylist(set, LEVELS), [LEVELS.findIndex((L) => L.id === 'dodge'), LEVELS.findIndex((L) => L.id === 'bubbles')]);
});

test('Party mix picks different levels each time, never repeats one, and never starts with the level just played', () => {
  const party = SETS.find((s) => s.id === 'party');
  const seen = new Set();
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 200; k++) {
    const last = k % LEVELS.length;
    const order = setPlaylist(party, LEVELS, last, rand);
    assert.equal(order.length, party.count);
    assert.equal(new Set(order).size, order.length, 'no level twice');
    assert.notEqual(order[0], last, 'not the level just played first');
    order.forEach((i) => seen.add(i));
  }
  assert.equal(seen.size, LEVELS.length, 'every level comes up');
});

test("a set's card pictures its levels; Party mix shows a spread", () => {
  const active = SETS.find((s) => s.id === 'active');
  assert.deepEqual(setPictures(active, LEVELS).map((L) => L.id), active.levels);
  const mix = setPictures(SETS[0], LEVELS);
  assert.equal(new Set(mix).size, SETS[0].count);
});
