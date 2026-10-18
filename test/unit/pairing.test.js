// The rules of the Cloudflare pairing function (cloudflare/rules.js): who may join a room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinDecision } from '../../cloudflare/rules.js';

const KEY = 'k3yOfTheRealHost_0123';

test('a host with a key opens an empty room, and the same key takes over its own old connection', () => {
  assert.equal(joinDecision('host', { host: 0, guest: 0 }, KEY).ok, true);
  assert.equal(joinDecision('host', { host: 1, guest: 1, hostKey: KEY }, KEY).ok, true);
});

test('a stranger with the room code cannot replace the host', () => {
  const v = joinDecision('host', { host: 1, guest: 1, hostKey: KEY }, 'someoneElsesKey_98765');
  assert.equal(v.ok, false);
  assert.equal(v.status, 409);
  // an old host socket that somehow has no key is not a way in either
  assert.equal(joinDecision('host', { host: 1, guest: 0, hostKey: null }, KEY).ok, false);
});

test('a host without a proper key is refused', () => {
  for (const key of [null, '', 'short', 'x'.repeat(65), 'has spaces in it ok?']) {
    const v = joinDecision('host', { host: 0, guest: 0 }, key);
    assert.equal(v.ok, false, String(key));
    assert.equal(v.status, 400);
  }
});

test('nobody can join a room that has no host (a mistyped code, or a guesser)', () => {
  const v = joinDecision('guest', { host: 0, guest: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.status, 404);
});

test('a second guest is turned away while the first is in, so a stranger cannot push the family out', () => {
  assert.equal(joinDecision('guest', { host: 1, guest: 0 }).ok, true);
  const v = joinDecision('guest', { host: 1, guest: 1 });
  assert.equal(v.ok, false);
  assert.equal(v.status, 409);
});

test('anything else is refused', () => {
  assert.equal(joinDecision(null, { host: 1, guest: 0 }).ok, false);
  assert.equal(joinDecision('admin', { host: 1, guest: 0 }, KEY).ok, false);
});
