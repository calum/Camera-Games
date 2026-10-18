// Unit tests for Dig Down, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import dig, { makeRow, pickColumn, brick, COLS, LAYERS } from '../../src/levels/dig.js';

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
const colX = (c) => (c + 0.5) * 384;
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

// A level with a hand-made mine: rows[r] is a string of COLS letters,
// d = dirt (1 hit), s = stone (2), m = metal, t = TNT, g = gem (dirt + gem), c = chest, . = already dug
function setup(players, rows) {
  const g = makeG(players);
  dig.start(g);
  const types = { d: () => brick('dirt', 1), s: () => brick('dirt', 2), m: () => brick('metal', Infinity), t: () => brick('tnt', 1), g: () => brick('dirt', 1, 'gem'), c: () => brick('chest', 3, 'chest'), '.': () => ({ ...brick('dirt', 1), broken: true }) };
  rows.forEach((s, r) => {
    dig.rows[r].bricks = [...s].map((ch) => types[ch]());
  });
  run(g, 0.1); // the level sees everyone standing before the first jump
  return g;
}

const at = (c, r) => dig.rows[r].bricks[c];
const kidOf = (id) => dig.kids.get(id);

test('dig: a jump breaks the brick under the kid and scores 1; standing still does nothing', () => {
  const p = kid();
  const g = setup([p], ['ddddd', 'ddddd']);
  run(g, 2);
  assert.equal(p.score, 0);
  assert.equal(at(2, 0).broken, false);
  jump(g, [1]);
  assert.equal(at(2, 0).broken, true);
  assert.equal(p.score, 1);
  run(g, 0.5);
  assert.equal(kidOf(1).y, 0, 'dropped into the hole they dug');
});

test('dig: staying in the air for a long time is one stomp, not one per frame', () => {
  const g = setup([kid()], ['sssss', 'sssss']);
  run(g, 1.5, new Set([1]));
  run(g, 0.5);
  assert.equal(at(2, 0).hp, 1);
});

test('dig: an old jump from before the level started does not count', () => {
  const p = kid({ lastJump: 5 });
  const g = makeG([p]);
  g.now = 5.1;
  dig.start(g);
  run(g, 1);
  assert.equal(at(2, 0).broken, false);
});

test('dig: a stone brick takes two stomps', () => {
  const g = setup([kid()], ['sssss', 'sssss']);
  jump(g, [1]);
  assert.equal(at(2, 0).broken, false);
  jump(g, [1]);
  assert.equal(at(2, 0).broken, true);
});

test('dig: a gem brick is worth 1 + 3, a treasure chest 3 stomps and 1 + 10', () => {
  const a = kid({ id: 1, x: colX(0) });
  const b = kid({ id: 2, x: colX(2) });
  const g = setup([a, b], ['gdcdd', 'ddddd']);
  jump(g, [1, 2]);
  jump(g, [2]);
  jump(g, [2]);
  assert.deepEqual([a.score, b.score], [4, 11]);
});

test('dig: metal bricks never break, however many times you stomp', () => {
  const p = kid();
  const g = setup([p], ['ddmdd', 'ddddd']);
  for (let i = 0; i < 5; i++) jump(g, [1]);
  assert.equal(at(2, 0).broken, false);
  assert.equal(p.score, 0);
  assert.equal(kidOf(1).y, -1);
});

test('dig: stepping sideways into a wall and jumping climbs up one brick at a time', () => {
  const p = kid();
  const g = setup([p], ['ddddd', 'ddddd', 'ddddd']);
  jump(g, [1]);
  jump(g, [1]); // two rows down in column 2
  run(g, 0.5);
  assert.equal(kidOf(1).y, 1);
  p.cx = colX(3); // step into the undug column: inside its brick at row 1
  run(g, 0.5);
  assert.equal(kidOf(1).col, 3);
  jump(g, [1]);
  assert.equal(kidOf(1).y, 0, 'climbed, nothing broken');
  assert.equal(at(3, 1).broken, false);
  jump(g, [1]);
  assert.equal(kidOf(1).y, -1, 'back on the surface');
  jump(g, [1]);
  assert.equal(at(3, 0).broken, true, 'on top of the column, a jump digs again');
});

test('dig: walking over a shaft someone else dug drops you down it', () => {
  const a = kid({ id: 1, x: colX(1) });
  const b = kid({ id: 2, x: colX(3) });
  const g = setup([a, b], ['ddddd', 'ddddd', 'ddddd']);
  jump(g, [1]);
  jump(g, [1]);
  run(g, 0.5);
  b.cx = colX(1);
  run(g, 1);
  assert.equal(kidOf(2).y, 1, 'fell to the bottom of the shaft');
});

test('dig: TNT goes off a moment after the stomp and takes the bricks beside and below with it, not metal', () => {
  const p = kid();
  const g = setup([p], ['dgtmd', 'ddsdd', 'ddddd']);
  run(g, 0.3, new Set([1]));
  run(g, 0.2); // the stomp has landed, the fuse is burning
  assert.equal(at(2, 0).fuse > 0, true, 'fuse is burning');
  assert.equal(at(2, 0).broken, false);
  run(g, 1);
  assert.equal(at(2, 0).broken, true);
  assert.equal(at(1, 0).broken, true, 'left');
  assert.equal(at(2, 1).broken, true, 'below');
  assert.equal(at(3, 0).broken, false, 'metal on the right survives');
  assert.equal(at(0, 0).broken, false, 'two away is out of range');
  assert.equal(p.score, 1 + 4 + 1, 'the kid who lit it gets the gem');
});

test('dig: TNT sets off TNT next to it', () => {
  const g = setup([kid()], ['dtttd', 'ddddd']);
  jump(g, [1]);
  run(g, 1);
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => at(c, 0).broken), [true, true, true, true, true]);
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

test('dig: the surface is plain dirt; metal and TNT only turn up deeper, never blocking a whole row', () => {
  for (let i = 0; i < 50; i++) assert.ok(makeRow(0).bricks.every((b) => b.kind === 'dirt' && b.hp === 1));
  const kinds = new Set();
  for (let r = 0; r < 60; r++) {
    const row = makeRow(r);
    for (const b of row.bricks) kinds.add(b.kind);
    const metal = row.bricks.map((b) => b.kind === 'metal');
    assert.ok(metal.filter(Boolean).length <= 2, `row ${r}: too much metal`);
    for (let c = 1; c < COLS; c++) assert.ok(!(metal[c] && metal[c - 1]), `row ${r}: metal side by side`);
  }
  assert.ok(kinds.has('metal') && kinds.has('tnt') && kinds.has('chest'));
});

test('dig: deep down, a prize under a metal cap always has TNT beside it', () => {
  const deep = LAYERS.findIndex((l) => l.puzzle) * 3;
  let found = 0;
  for (let i = 0; i < 20; i++) {
    const r = Math.ceil(deep / 4) * 4 + 4 * (i % 3);
    const cap = makeRow(r);
    const c = cap.next.prizeCol;
    if (c === undefined) continue;
    found++;
    assert.equal(cap.bricks[c].kind, 'metal');
    const below = makeRow(r + 1, cap.next);
    assert.ok(below.bricks[c].prize, 'prize under the cap');
    assert.ok(below.bricks[c - 1]?.kind === 'tnt' || below.bricks[c + 1]?.kind === 'tnt', 'TNT next to it');
  }
  assert.ok(found > 0);
});

test('dig: survives a long run with no players, 3 players and players coming and going', () => {
  const g = makeG([]);
  dig.start(g);
  for (let i = 0; i < 60 * 70; i++) {
    g.now += 1 / 60;
    if (i === 300) g.players = [kid({ id: 1, x: 300 }), kid({ id: 2, x: 960 }), kid({ id: 3, x: 1700 })];
    if (i === 2000) g.players = [g.players[1]];
    for (const p of g.players) {
      if (i % 50 < 15) p.lastJump = g.now;
      if (i % 400 === 0) p.cx = colX(Math.floor(Math.random() * COLS));
    }
    dig.update(g, 1 / 60);
  }
  assert.ok(dig.deepest >= 4, `dug to row ${dig.deepest}`);
  assert.equal(g.levelEnd, null, 'digging never fails');
});
