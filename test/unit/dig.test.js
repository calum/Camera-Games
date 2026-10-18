// Unit tests for Dig Down, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import dig, { makeRow, pickColumn, layerAt } from '../../src/levels/dig.js';

function makeG(players = []) {
  return {
    W: 1920,
    H: 1080,
    u: 1,
    now: 0,
    diff: 1,
    players,
    team: { score: 0, hearts: 5, maxHearts: 5 },
    levelEnd: null,
    activePlayers() {
      return this.players.filter((p) => p.present);
    },
    score(p, pts) {
      if (p) p.score += pts;
      this.team.score += pts;
    },
    burst() {},
    endLevel(msg) {
      if (!this.levelEnd) this.levelEnd = msg;
    },
  };
}

// Columns are 384 px wide at 1920: column 0 is centred at 192, column 2 at 960.
function kid(over = {}) {
  const x = over.x ?? 960;
  return {
    id: over.id ?? 1,
    present: true,
    score: 0,
    cx: x,
    color: '#f00',
    px: Array.from({ length: 33 }, () => ({ x, y: 900 })),
    lastJump: -99,
    ...over,
  };
}

const brick = (hp = 1, prize = null) => ({ hp, max: hp, prize, broken: false, shake: 0 });
const row = (hps, prizes = []) => ({ depth: 0, layer: layerAt(0), bricks: hps.map((hp, i) => brick(hp, prizes[i] ?? null)), crumble: -1 });

function setup(players, hps = [1, 1, 1, 1, 1], prizes) {
  const g = makeG(players);
  dig.start(g);
  dig.rows[0] = row(hps, prizes);
  run(g, 0.1); // the level sees everyone standing before the first jump
  return g;
}

// Advance the game; `air` is a set of player ids that are in the air (lastJump refreshed each frame).
function run(g, seconds, air = new Set()) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.now += 1 / 60;
    for (const p of g.players) if (air.has(p.id)) p.lastJump = g.now;
    dig.update(g, 1 / 60);
  }
}

// One jump: 0.3 s in the air, then 0.7 s on the ground.
function jump(g, ids) {
  run(g, 0.3, new Set(ids));
  run(g, 0.7);
}

test('dig: a jump breaks the brick under the kid and scores 1; standing still does nothing', () => {
  const p = kid();
  const g = setup([p]);
  run(g, 2);
  assert.equal(p.score, 0);
  assert.equal(dig.rows[0].bricks[2].broken, false);
  jump(g, [1]);
  assert.equal(dig.rows[0].bricks[2].broken, true);
  assert.equal(p.score, 1);
});

test('dig: staying in the air for a long time is one stomp, not one per frame', () => {
  const p = kid();
  const g = setup([p], [3, 3, 3, 3, 3]);
  run(g, 1.5, new Set([1]));
  run(g, 0.5);
  assert.equal(dig.rows[0].bricks[2].hp, 2);
});

test('dig: an old jump from before the level started does not count', () => {
  const p = kid({ lastJump: 5 });
  const g = setup([p]);
  g.now = 5.1;
  run(g, 1);
  assert.equal(dig.rows[0].bricks[2].broken, false);
});

test('dig: a stone brick takes two stomps', () => {
  const p = kid();
  const g = setup([p], [2, 2, 2, 2, 2]);
  jump(g, [1]);
  assert.equal(dig.rows[0].bricks[2].broken, false);
  assert.equal(dig.rows[0].bricks[2].hp, 1);
  jump(g, [1]);
  assert.equal(dig.rows[0].bricks[2].broken, true);
});

test('dig: a gem brick is worth 1 + 3, a treasure chest 1 + 10', () => {
  const a = kid({ id: 1, x: 192 });
  const b = kid({ id: 2, x: 960 });
  const g = setup([a, b], [1, 1, 1, 1, 1], ['gem', null, 'chest']);
  jump(g, [1, 2]);
  assert.deepEqual([a.score, b.score], [4, 11]);
});

test('dig: after 3 bricks break the rest crumble, the team drops a row and gets their prizes', () => {
  const kids = [kid({ id: 1, x: 192 }), kid({ id: 2, x: 576 }), kid({ id: 3, x: 960 })];
  const g = setup(kids, [1, 1, 1, 2, 2], [null, null, null, 'gem', null]);
  const next = dig.rows[1];
  jump(g, [1, 2, 3]);
  assert.equal(dig.depth, 1, 'dropped one row');
  assert.equal(dig.rows[0], next, 'the next row is now under their feet');
  assert.equal(dig.rows.length, 6, 'a new row was added at the bottom');
  assert.equal(g.team.score, 3 + 3, '3 bricks + the gem left in the crumbled row');
});

test('dig: a kid who never moves still digs, because cracks spread from a hole to the nearest brick', () => {
  const p = kid();
  const g = setup([p]);
  for (let i = 0; i < 3; i++) jump(g, [1]);
  assert.equal(dig.depth, 1);
  for (let i = 0; i < 3; i++) jump(g, [1]);
  assert.equal(dig.depth, 2);
});

test('dig: two kids on the same brick break it twice as fast', () => {
  const a = kid({ id: 1, x: 900 });
  const b = kid({ id: 2, x: 1000 });
  const g = setup([a, b], [2, 2, 2, 2, 2]);
  jump(g, [1, 2]);
  assert.equal(dig.rows[0].bricks[2].broken, true);
});

test('dig: a wobble across a brick edge keeps the same brick; a real step moves to the next', () => {
  const W = 1920; // edge between columns 1 and 2 is at 768
  assert.equal(pickColumn(700, W), 1);
  assert.equal(pickColumn(790, W, 1), 1, 'just past the edge: stay');
  assert.equal(pickColumn(740, W, 2), 2, 'just past the edge the other way: stay');
  assert.equal(pickColumn(900, W, 1), 2, 'well past the edge: move');
  assert.equal(pickColumn(-50, W), 0);
  assert.equal(pickColumn(5000, W), 4);
});

test('dig: rows get tougher deeper down, and every 6th row hides one treasure chest', () => {
  assert.equal(makeRow(0).bricks.every((b) => b.hp === 1), true, 'the surface is easy');
  assert.ok(makeRow(40).bricks.every((b) => b.hp >= 2), 'deep rock is tough');
  for (let d = 0; d < 18; d++) {
    const chests = makeRow(d).bricks.filter((b) => b.prize === 'chest').length;
    assert.equal(chests, (d + 1) % 6 === 0 ? 1 : 0, `row ${d}`);
  }
});

test('dig: survives a long run with no players, 3 players and players coming and going', () => {
  const g = makeG([]);
  dig.start(g);
  for (let i = 0; i < 60 * 50; i++) {
    g.now += 1 / 60;
    if (i === 300) g.players = [kid({ id: 1, x: 300 }), kid({ id: 2, x: 960 }), kid({ id: 3, x: 1700 })];
    if (i === 2000) g.players = [g.players[1]];
    for (const p of g.players) if (i % 50 < 15) p.lastJump = g.now;
    dig.update(g, 1 / 60);
  }
  assert.ok(dig.depth >= 5, `dug ${dig.depth} rows`);
  assert.equal(g.levelEnd, null, 'digging never fails');
});
