// Unit tests for Dig Down, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import dig, { makeMine, pickColumn, brick, digLayout, safeColumn, COLS, LAYERS } from '../../src/levels/dig.js';

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
    misses: 0,
    miss() {
      this.misses++;
    },
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
// d = dirt (1 hit), s = stone (2), m = metal, t = TNT, g = gem (dirt + gem), c = chest, G = gold, . = already dug.
// The mine ends with a gold row unless the last string is one.
function setup(players, rows, g = makeG(players)) {
  dig.start(g);
  const types = { d: () => brick('dirt', 1), s: () => brick('dirt', 2), m: () => brick('metal', Infinity), t: () => brick('tnt', 1), g: () => brick('dirt', 1, 'gem'), c: () => brick('chest', 3, 'chest'), G: () => brick('gold', 1), '.': () => ({ ...brick('dirt', 1), broken: true }) };
  if (!rows.at(-1).startsWith('G')) rows = [...rows, 'G'.repeat(rows[0].length)];
  dig.rows = rows.map((s, r) => ({ row: r, layer: LAYERS[0], gold: s[0] === 'G', bricks: [...s].map((ch) => types[ch]()) }));
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

test('dig: stepping sideways at depth tunnels into the next column, so you keep digging down from there', () => {
  // Calum's play test: having to climb back to the top of a column was too hard and frustrating
  const p = kid();
  const g = setup([p], ['ddddd', 'ddddd', 'ddddd', 'ddddd']);
  jump(g, [1]);
  jump(g, [1]); // two rows down in column 2
  run(g, 0.5);
  assert.equal(kidOf(1).y, 1);
  p.cx = colX(3); // step into the undug column at row 1
  run(g, 0.5);
  assert.equal(kidOf(1).col, 3);
  assert.equal(kidOf(1).y, 1, 'same depth, no climbing');
  assert.equal(at(3, 1).broken, true, 'tunnelled through');
  assert.equal(at(3, 0).broken, false, 'the bricks above are still there');
  assert.equal(p.score, 2, 'a tunnel is no stomp point (walking to and fro is not a way to score)');
  jump(g, [1]);
  assert.equal(at(3, 2).broken, true, 'the next jump digs on down');
});

test('dig: metal under you is a step to the side, even when the side is metal too', () => {
  const p = kid({ x: colX(1) });
  const g = setup([p], ['ddddd', 'mmmdd', 'ddddd']);
  jump(g, [1]);
  run(g, 0.5);
  assert.equal(kidOf(1).y, 0);
  jump(g, [1]);
  assert.equal(at(1, 1).broken, false, 'metal holds');
  p.cx = colX(0); // sideways into the next column, metal below there too
  run(g, 0.5);
  p.cx = colX(2);
  run(g, 0.5);
  assert.equal(kidOf(1).y, 0);
  jump(g, [1]); // still metal under column 2... so through to column 3
  p.cx = colX(3);
  run(g, 0.5);
  jump(g, [1]);
  run(g, 0.5);
  assert.equal(kidOf(1).y, 1, 'down past the metal');
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
  const w = 384; // edge between columns 1 and 2 is at 768
  assert.equal(pickColumn(700, w, COLS), 1);
  assert.equal(pickColumn(790, w, COLS, 1), 1, 'just past the edge: stay');
  assert.equal(pickColumn(740, w, COLS, 2), 2, 'just past the edge the other way: stay');
  assert.equal(pickColumn(900, w, COLS, 1), 2, 'well past the edge: move');
  assert.equal(pickColumn(-50, w, COLS), 0);
  assert.equal(pickColumn(5000, w, COLS), 4);
  assert.equal(pickColumn(5000, w, 1), 0, 'one column: always it');
});

test('dig: each level starts plain, ends in gold, and gets harder; metal never blocks the middle or a whole row', () => {
  for (let i = 0; i < 50; i++) assert.ok(makeMine(0)[0].bricks.every((b) => b.kind === 'dirt' && b.hp === 1), 'the very top is plain dirt');
  const kinds = new Set();
  for (const n of [1, 2, 3, 4, 5]) {
    for (let level = 0; level < 8; level++) {
      for (let i = 0; i < 10; i++) {
        const rows = makeMine(level, n);
        assert.equal(rows.length, LAYERS[Math.min(level, LAYERS.length - 1)].rows + 1);
        assert.ok(rows.at(-1).gold && rows.at(-1).bricks.every((b) => b.kind === 'gold'), 'a gold row at the bottom');
        assert.ok(rows[0].bricks.every((b) => b.kind === 'dirt'), `level ${level}: starts plain`);
        assert.equal(rows.flatMap((r) => r.bricks).filter((b) => b.kind === 'chest').length, 1, 'one treasure chest');
        for (const row of rows) {
          assert.equal(row.bricks.length, n);
          for (const b of row.bricks) kinds.add(b.kind);
          const metal = row.bricks.map((b) => b.kind === 'metal');
          assert.ok(!metal[safeColumn(n)], `level ${level}, ${n} columns: metal in the middle column`);
          assert.ok(metal.filter(Boolean).length <= Math.floor((n - 1) / 2), `level ${level}: too much metal`);
          for (let c = 1; c < n; c++) assert.ok(!(metal[c] && metal[c - 1]), `level ${level}: metal side by side`);
        }
      }
    }
  }
  assert.ok(kinds.has('metal') && kinds.has('tnt') && kinds.has('chest'));
  for (let l = 1; l < LAYERS.length; l++) {
    assert.ok(LAYERS[l].hp[1] >= LAYERS[l - 1].hp[1] && LAYERS[l].metal >= LAYERS[l - 1].metal && LAYERS[l].tnt >= LAYERS[l - 1].tnt, `${LAYERS[l].name} is harder`);
  }
});

test('dig: deep down, a prize under a metal cap always has TNT beside it', () => {
  const deep = LAYERS.findIndex((l) => l.puzzle);
  let found = 0;
  for (let i = 0; i < 20; i++) {
    const rows = makeMine(deep + (i % 3));
    for (let r = 1; r < rows.length - 1; r++) {
      const c = rows[r].prizeCol;
      if (c === undefined) continue;
      found++;
      assert.equal(rows[r - 1].bricks[c].kind, 'metal', 'a metal cap');
      assert.ok(rows[r].bricks[c].prize, 'a prize under it');
      assert.ok(rows[r].bricks[c - 1]?.kind === 'tnt' || rows[r].bricks[c + 1]?.kind === 'tnt', 'TNT next to it');
    }
  }
  assert.ok(found > 0);
});

test('dig: breaking the gold row is LEVEL 1 COMPLETE, and everyone falls into a harder level', () => {
  const a = kid({ id: 1, x: colX(2) });
  const b = kid({ id: 2, x: colX(4) });
  const g = setup([a, b], ['ddddd', 'GGGGG']);
  jump(g, [1]);
  run(g, 0.5);
  assert.equal(kidOf(1).y, 0);
  jump(g, [1]); // through the gold
  assert.ok(dig.messages.some((m) => m.text === 'LEVEL 1 COMPLETE!'), dig.messages.map((m) => m.text).join());
  assert.equal(a.score, 1 + 5);
  run(g, 1);
  assert.equal(dig.level, 1);
  assert.equal(dig.rows[0].layer.name, LAYERS[1].name);
  assert.deepEqual([kidOf(1).y, kidOf(2).y], [-1, -1], 'both kids at the top of the new level');
  jump(g, [2]);
  assert.equal(dig.rows[0].bricks[4].broken || dig.rows[0].bricks[4].hp < dig.rows[0].bricks[4].max, true, 'digging on in the new level');
});

test('dig: the columns sit over the play space; a narrow one gets fewer, a very narrow one a single shaft', () => {
  assert.deepEqual(digLayout(), { n: COLS, left: 0, colW: 0.2 });
  const W = 1920;
  for (const [x0, x1, n] of [[0.4, 0.9, 4], [0.05, 0.35, 3], [0.6, 0.8, 2], [0.45, 0.55, 1], [0, 0.3, 3]]) {
    const lay = digLayout({ x0, x1, reach0: x0 - 0.05, reach1: x1 + 0.05 });
    assert.equal(lay.n, n, `${x0}-${x1}: ${lay.n} columns`);
    assert.ok(lay.left >= -1e-9 && lay.left + lay.n * lay.colW <= 1 + 1e-9, 'on screen');
    // a kid at either edge of the space is in an end column, and the middle of the space is the safe column
    const col = (x) => pickColumn((x - lay.left) * W, lay.colW * W, lay.n);
    assert.equal(col(x0), 0);
    assert.equal(col(x1), n - 1);
    if (n % 2) assert.equal(col((x0 + x1) / 2), safeColumn(n));
  }
});

// A kid who stays in one place and keeps jumping, for a whole game
function dig60(area, x) {
  const p = kid({ x });
  const g = makeG([p]);
  g.area = area;
  dig.start(g);
  for (let i = 0; i < 60 * 60; i++) {
    g.now += 1 / 60;
    if (i % 60 < 18) p.lastJump = g.now; // a jump a second
    dig.update(g, 1 / 60);
  }
  return dig.level;
}

test('dig: there is always a way down: jumping in the middle of the play space gets through level after level', () => {
  // the middle column never has metal, so a kid who never moves still finishes levels; the same in a play
  // space so narrow it is a single shaft (dig straight down all the way)
  for (let i = 0; i < 5; i++) {
    assert.ok(dig60(null, 960) >= 3, 'whole screen, middle');
    assert.ok(dig60({ x0: 0.1, x1: 0.2, reach0: 0.05, reach1: 0.25 }, 0.15 * 1920) >= 3, 'narrow space on the left');
  }
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
  assert.ok(dig.above + dig.deepest >= 4, `dug ${dig.above + dig.deepest} rows`);
  assert.equal(g.levelEnd, null, 'digging never fails');
});
