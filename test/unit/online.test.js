// Family play, the pure part: room codes, what a guest sends, how the host turns it into players, and the
// cut-out video frame. No network and no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoomCode, normaliseCode, packPlayers, RemoteCrowd, decodeDoubleWide, REMOTE_ID_BASE, CODE_LENGTH } from '../../src/online.js';

// A kid in a 1920x1080 screen with arms out like an airplane (or not).
function kid(id, cx, { airplane = false, look = [0.2, 0.4] } = {}) {
  const px = Array.from({ length: 33 }, () => ({ x: cx, y: 540 }));
  const set = (i, x, y) => (px[i] = { x, y });
  set(0, cx, 200);
  set(11, cx - 50, 300); set(12, cx + 50, 300);
  set(23, cx - 40, 500); set(24, cx + 40, 500);
  set(25, cx - 40, 700); set(26, cx + 40, 700);
  if (airplane) { set(15, cx - 200, 300); set(16, cx + 200, 300); } else { set(15, cx - 60, 450); set(16, cx + 60, 450); }
  return { id, px, look };
}

test('room codes are five easy letters and typed codes are tidied', () => {
  for (let i = 0; i < 200; i++) {
    const c = makeRoomCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.match(c, /^[BCDFGHJKLMNPRSTVWXZ]+$/, 'no vowels, so no accidental words');
    assert.equal(normaliseCode(c), c);
  }
  assert.equal(normaliseCode(' bk-tpl '), 'BKTPL');
  assert.equal(normaliseCode('ABCDE'), null, 'vowels are not in any code');
  assert.equal(normaliseCode('BKTP'), null);
  assert.equal(normaliseCode(null), null);
});

test('a guest\'s kids arrive on the host\'s screen where they stood on theirs, whatever the screen sizes', () => {
  const msg = packPlayers([kid(1, 480)], 1920, 1080, 0);
  const crowd = new RemoteCrowd();
  crowd.ingest(msg, 1, 1280, 720); // a smaller host screen
  const [p] = crowd.tick(1);
  assert.equal(p.id, REMOTE_ID_BASE + 1);
  assert.equal(p.remote, true);
  assert.ok(Math.abs(p.px[0].x - 320) < 1 && Math.abs(p.px[0].y - 133.3) < 1, 'nose at 25% across, 18.5% down');
  assert.ok(Math.abs(p.shoulderW - 66.7) < 1, 'features are worked out on the host (shoulders 100 px -> 66.7 px)');
});

test('the message survives JSON, which is how it travels', () => {
  const sent = packPlayers([kid(2, 960)], 1920, 1080, 7);
  const got = JSON.parse(JSON.stringify(sent));
  const crowd = new RemoteCrowd();
  crowd.ingest(got, 1, 1920, 1080);
  assert.ok(Math.abs(crowd.players[0].cx - 960) < 0.1);
});

test('a guest holding their arms out is recognised as an airplane, so they can join the lobby', () => {
  const crowd = new RemoteCrowd();
  for (let i = 0; i < 12; i++) crowd.ingest(packPlayers([kid(1, 960, { airplane: true })], 1920, 1080, i), 1 + i / 30, 1920, 1080);
  assert.equal(crowd.players[0].pose.airplane, true);
  const other = new RemoteCrowd();
  for (let i = 0; i < 12; i++) other.ingest(packPlayers([kid(1, 960)], 1920, 1080, i), 1 + i / 30, 1920, 1080);
  assert.equal(other.players[0].pose.airplane, false);
});

test('guests get colours the host\'s own kids are not using, and keep them', () => {
  const crowd = new RemoteCrowd();
  crowd.ingest(packPlayers([kid(1, 500), kid(2, 1400)], 1920, 1080, 0), 1, 1920, 1080, [0, 1]);
  const slots = crowd.players.map((p) => p.slot);
  assert.deepEqual(slots, [2, 3]);
  crowd.ingest(packPlayers([kid(2, 1400)], 1920, 1080, 1), 1.1, 1920, 1080, [0, 1]);
  assert.equal(crowd.players.find((p) => p.id === REMOTE_ID_BASE + 2).slot, 3);
});

test('nothing pops: a guest stays through a short dropout, is hidden after it, and comes back with their score', () => {
  const crowd = new RemoteCrowd();
  crowd.ingest(packPlayers([kid(1, 960)], 1920, 1080, 0), 1, 1920, 1080);
  crowd.players[0].score = 42;
  assert.equal(crowd.tick(1.5).length, 1, '0.5 s without news: still here');
  assert.equal(crowd.tick(2.0).length, 0, '1 s without news: not present...');
  assert.equal(crowd.players.length, 1, '...but remembered');
  crowd.ingest(packPlayers([kid(1, 960)], 1920, 1080, 1), 10, 1920, 1080);
  assert.equal(crowd.tick(10).length, 1);
  assert.equal(crowd.players[0].score, 42);
  assert.equal(crowd.tick(40).length, 0);
  assert.equal(crowd.players.length, 0, 'forgotten after 20 s');
});

test('a late message that overtook a newer one is ignored', () => {
  const crowd = new RemoteCrowd();
  crowd.ingest(packPlayers([kid(1, 1500)], 1920, 1080, 5), 1, 1920, 1080);
  crowd.ingest(packPlayers([kid(1, 300)], 1920, 1080, 4), 1.01, 1920, 1080);
  assert.ok(crowd.players[0].cx > 1400);
  crowd.reset();
  crowd.ingest(packPlayers([kid(1, 300)], 1920, 1080, 0), 2, 1920, 1080);
  assert.ok(crowd.players[0].cx < 400, 'after a reconnect the numbering starts again');
});

test('a garbage message does not make a player or throw', () => {
  const crowd = new RemoteCrowd();
  crowd.ingest({ n: 0, ps: [{ i: 1, l: null, p: [0.1, 0.2] }, null, { i: 2, l: null }] }, 1, 1920, 1080);
  assert.equal(crowd.players.length, 0);
});

test('the cut-out frame: colour comes back at full strength, see-through stays see-through', () => {
  const w = 3, h = 1;
  const src = new Uint8ClampedArray(w * 2 * h * 4);
  const put = (x, r, g, b) => src.set([r, g, b, 255], x * 4);
  // pixel 0: opaque orange. pixel 1: half see-through orange (colour half holds colour * alpha). pixel 2: nothing.
  put(0, 255, 128, 0); put(w + 0, 255, 255, 255);
  put(1, 128, 64, 0); put(w + 1, 128, 128, 128);
  put(2, 0, 0, 0); put(w + 2, 0, 0, 0);
  const dst = new Uint8ClampedArray(w * h * 4);
  decodeDoubleWide(src, w, h, dst);
  assert.deepEqual([...dst.slice(0, 4)], [255, 128, 0, 255]);
  const [r, g, b, a] = dst.slice(4, 8);
  assert.ok(Math.abs(r - 255) <= 2 && Math.abs(g - 128) <= 2 && b === 0 && a === 128, `unpremultiplied: ${[r, g, b, a]}`);
  assert.deepEqual([...dst.slice(8, 12)], [0, 0, 0, 0]);
});
