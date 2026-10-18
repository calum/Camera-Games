// The rules of the Cloudflare pairing function (cloudflare/rules.js): who may join a room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinDecision } from '../../cloudflare/rules.js';

test('a host can always open a room, including a reloaded host replacing the old one', () => {
  assert.equal(joinDecision('host', { host: 0, guest: 0 }).ok, true);
  assert.equal(joinDecision('host', { host: 1, guest: 1 }).ok, true);
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
  assert.equal(joinDecision('admin', { host: 1, guest: 0 }).ok, false);
});
