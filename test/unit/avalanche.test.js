// Unit tests for Avalanche!, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import avalanche, {
  rockGap,
  nearDistance,
  jumpedInTime,
  inGap,
  shadowGrow,
  DURATION,
  BOULDER_TIME,
  BIG_BEFORE_END,
  BIG_WARN,
  BIG_FALL,
} from '../../src/levels/avalanche.js';

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

function kid(over = {}) {
  const x = over.x ?? 960;
  return {
    id: over.id ?? 1,
    present: true,
    score: 0,
    cx: x,
    shoulderW: 100,
    sh: { x, y: 300 },
    hip: { x, y: 500 },
    px: Array.from({ length: 33 }, () => ({ x, y: 300 })),
    hands: [{ x: -999, y: -999 }],
    circles: [{ x, y: 500, r: 50 }],
    lastJump: -99,
    hitUntil: 0,
    pose: {},
    ...over,
  };
}

// Level with the random spawners switched off, so each test controls exactly what is on screen.
function setup(players) {
  const g = makeG(players);
  avalanche.start(g);
  avalanche.spawn = 999;
  avalanche.nextBoulder = 999;
  return g;
}
const rock = (over = {}) => ({ x: 960, y: 500, r: 50, vy: 0, warn: 0, rot: 0, spin: 0, track: new Map(), paid: new Set(), ...over });
const step = (g, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.now += 1 / 60;
    avalanche.update(g, 1 / 60);
  }
};
const phews = () => avalanche.feedback.filter((f) => f.text.startsWith('PHEW'));

test('avalanche: has the full level interface and uses shared hearts', () => {
  assert.equal(avalanche.id, 'avalanche');
  assert.equal(avalanche.hearts, true);
  assert.equal(avalanche.duration, 50);
  assert.equal(avalanche.color, '#9ad0ff');
  for (const k of ['start', 'update', 'draw']) assert.equal(typeof avalanche[k], 'function');
  assert.ok(avalanche.title && avalanche.hint);
  const g = makeG();
  g.team.hearts = 1;
  avalanche.start(g);
  assert.equal(g.team.hearts, 5, 'start resets the hearts');
});

test('avalanche: survives a long run with no players, 3 players and mid-run player changes (update and draw)', () => {
  const g = makeG([]);
  const calls = new Proxy({}, { get: () => () => {} });
  const ctx = new Proxy(
    {},
    {
      get: (_, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : calls[k]),
      set: () => true,
    },
  );
  avalanche.start(g);
  for (let i = 0; i < 60 * 50; i++) {
    g.now += 1 / 60;
    if (i === 600) g.players = [kid({ id: 1, x: 400 }), kid({ id: 2, x: 960 }), kid({ id: 3, x: 1500 })];
    if (i === 1500) g.players = [g.players[0]];
    if (i === 2000) g.players = [];
    if (i === 2400) g.players = [kid({ id: 4, x: 700, shoulderW: undefined })];
    avalanche.update(g, 1 / 60);
    if (i % 30 === 0) avalanche.draw(g, ctx);
  }
});

test('avalanche: a rock hitting a kid costs one heart, with brief invulnerability', () => {
  const p = kid();
  const g = setup([p]);
  avalanche.rocks = [rock(), rock()]; // two rocks arrive in the same instant
  avalanche.update(g, 0.016);
  assert.equal(g.team.hearts, 4, 'only one heart lost despite two rocks');
  assert.ok(p.hitUntil > g.now);
  avalanche.rocks = [rock()];
  avalanche.update(g, 0.016);
  assert.equal(g.team.hearts, 4, 'still invulnerable');
  step(g, 1.1);
  avalanche.rocks = [rock()];
  avalanche.update(g, 0.016);
  assert.equal(g.team.hearts, 3, 'vulnerable again after 1 s');
});

test('avalanche: running out of hearts ends the level', () => {
  const g = setup([kid()]);
  g.team.hearts = 1;
  avalanche.rocks = [rock()];
  avalanche.update(g, 0.016);
  assert.equal(g.levelEnd, 'Oh no, out of hearts! Try again!');
});

test('avalanche: a warning rock cannot hurt anyone yet', () => {
  const g = setup([kid()]);
  avalanche.rocks = [rock({ warn: 0.5 })];
  avalanche.update(g, 0.016);
  assert.equal(g.team.hearts, 5);
});

test('avalanche: a rock that lands safely scores a team point', () => {
  const g = setup([kid({ x: 200, circles: [{ x: 200, y: 500, r: 50 }] })]);
  avalanche.rocks = [rock({ x: 1500, y: 1200 })];
  avalanche.update(g, 0.016);
  assert.equal(g.team.score, 1);
});

test('avalanche: a rock passing close to a kid gives PHEW +1 once, with floating text', () => {
  const p = kid();
  const g = setup([p]);
  // 120 px away from the body centre: edge gap = 120 - (50 + 40) = 30, inside the 60 px near-miss window
  avalanche.rocks = [rock({ x: 1080, y: 100, vy: 600 })];
  step(g, 1.2);
  assert.equal(p.score, 1);
  assert.equal(g.team.hearts, 5);
  assert.equal(phews().length, 1);
  assert.ok(phews()[0].life <= 1.1);
  step(g, 1.5);
  assert.equal(phews().length, 0, 'the text fades away');
  assert.equal(p.score, 1);
});

test('avalanche: a far miss does not score', () => {
  const p = kid();
  const g = setup([p]);
  avalanche.rocks = [rock({ x: 1300, y: 100, vy: 600 })];
  step(g, 2);
  assert.equal(p.score, 0);
  assert.equal(phews().length, 0);
  assert.equal(g.team.score, 1, 'only the landing point');
});

test('avalanche: the near-miss distance follows the shoulder width, falling back to 60u', () => {
  assert.equal(nearDistance({ shoulderW: 200 }, 1), 120);
  assert.equal(nearDistance({}, 2), 120);
  const wide = kid({ shoulderW: 300 }); // near window 180 px
  const g = setup([wide]);
  avalanche.rocks = [rock({ x: 1200, y: 100, vy: 600 })]; // centre distance 240, edge gap 150 < 180
  step(g, 1.2);
  assert.equal(wide.score, 1);
});

test('avalanche: a direct hit is not also a near miss', () => {
  const p = kid();
  const g = setup([p]);
  avalanche.rocks = [rock({ x: 960, y: 100, vy: 600 })];
  step(g, 1.5);
  assert.equal(g.team.hearts, 4);
  assert.equal(p.score, 0);
  assert.equal(phews().length, 0);
});

test('avalanche: a rock that overlapped a kid during invulnerability is not a near miss', () => {
  const p = kid();
  const g = setup([p]);
  avalanche.invul = 5;
  avalanche.rocks = [rock({ x: 960, y: 100, vy: 600 })];
  step(g, 1.5);
  assert.equal(g.team.hearts, 5);
  assert.equal(p.score, 0, 'it went through the kid, so it was not a miss');
});

test('avalanche: each kid gets their own near miss, once per rock', () => {
  const a = kid({ id: 1, x: 500, circles: [{ x: 500, y: 500, r: 50 }] });
  const b = kid({ id: 2, x: 1400, circles: [{ x: 1400, y: 500, r: 50 }] });
  const g = setup([a, b]);
  avalanche.rocks = [rock({ x: 620, y: 100, vy: 600 }), rock({ x: 1520, y: 100, vy: 600 })];
  step(g, 1.5);
  assert.deepEqual([a.score, b.score], [1, 1]);
});

function boulderAt(g, dir = 1) {
  const b = { dir, t: 0.5, x: 960, rot: 0, judged: new Map() };
  avalanche.boulders = [b];
  return b;
}
test('avalanche: rolling boulder, a jump in the window is safe, +1 and green', () => {
  const p = kid({ lastJump: 0 });
  const g = setup([p]);
  g.now = 10;
  p.lastJump = 9.8; // 0.2 s before it arrives: inside the 0.5 s early window
  const b = boulderAt(g);
  b.t = (960 + 170) / (1920 + 340) * BOULDER_TIME; // x == 960 after the update
  avalanche.update(g, 0.0001);
  step(g, 0.5);
  assert.equal(p.score, 1);
  assert.equal(g.team.hearts, 5);
  assert.equal(p.flashColor, '#4dff88');
  assert.ok(avalanche.feedback.some((f) => f.color === '#4dff88'));
});

test('avalanche: rolling boulder, no jump loses one heart (red), then invulnerable', () => {
  const p = kid();
  const g = setup([p]);
  g.now = 10;
  const b = boulderAt(g);
  b.t = (960 + 170) / (1920 + 340) * BOULDER_TIME;
  avalanche.update(g, 0.0001);
  step(g, 0.5);
  assert.equal(p.score, 0);
  assert.equal(g.team.hearts, 4);
  assert.equal(p.flashColor, '#ff5a5a');
  assert.ok(avalanche.feedback.some((f) => f.color === '#ff6b6b'));
  assert.equal(avalanche.boulders[0]?.judged.size ?? 1, 1, 'judged once, not every frame');
});

test('avalanche: rolling boulder, a late jump or one that is far too early does not count', () => {
  assert.equal(jumpedInTime(9.55, 10), true);
  assert.equal(jumpedInTime(9.45, 10), false, 'more than 0.5 s early');
  assert.equal(jumpedInTime(10.3, 10), true);
  assert.equal(jumpedInTime(10.35, 10), false, 'more than 0.3 s late');
});

test('avalanche: rolling boulder, two kids are judged separately', () => {
  const a = kid({ id: 1, x: 900, lastJump: 9.8 });
  const b = kid({ id: 2, x: 1000, lastJump: -99 });
  const g = setup([a, b]);
  g.now = 10;
  const bo = boulderAt(g);
  bo.t = (960 + 170) / (1920 + 340) * BOULDER_TIME;
  avalanche.update(g, 0.0001);
  step(g, 0.5);
  assert.deepEqual([a.score, b.score], [1, 0]);
  assert.equal(g.team.hearts, 4, 'only the kid who did not jump cost a heart');
});

test('avalanche: two kids who both miss the jump still cost only one heart (shared invulnerability)', () => {
  const a = kid({ id: 1, x: 900 });
  const b = kid({ id: 2, x: 1000 });
  const g = setup([a, b]);
  g.now = 10;
  const bo = boulderAt(g);
  bo.t = (960 + 170) / (1920 + 340) * BOULDER_TIME;
  avalanche.update(g, 0.0001);
  step(g, 0.5);
  assert.equal(g.team.hearts, 4);
});

test('avalanche: boulders are announced from 12 s in, with a countdown first', () => {
  const g = makeG([kid()]);
  avalanche.start(g);
  avalanche.spawn = 999;
  for (let i = 0; i < 60 * 11.5; i++) {
    g.now += 1 / 60;
    avalanche.update(g, 1 / 60);
  }
  assert.equal(avalanche.boulders.length, 0);
  step(g, 1);
  assert.equal(avalanche.boulders.length, 1);
  assert.ok(avalanche.boulders[0].t < 0, 'still counting down');
  assert.ok(avalanche.nextBoulder - avalanche.elapsed > 5, 'next one is 8-10 s away');
});

// ---- the giant boulder
function startBig(players) {
  const g = setup(players);
  avalanche.elapsed = DURATION - BIG_BEFORE_END;
  avalanche.update(g, 0.001);
  return g;
}

test('avalanche: the giant boulder appears in the last BIG_BEFORE_END s, with a gap about 1/4 of the screen', () => {
  const g = startBig([kid()]);
  const big = avalanche.big;
  assert.ok(big);
  assert.ok(Math.abs(big.gapW - g.W / 4) < 1);
  assert.ok(big.gapX - big.gapW / 2 >= 0 && big.gapX + big.gapW / 2 <= g.W);
  assert.equal(inGap(big.gapX + big.gapW / 2 - 1, big.gapX, big.gapW), true);
  assert.equal(inGap(big.gapX + big.gapW / 2 + 1, big.gapX, big.gapW), false);
});

test('avalanche: normal rocks stop spawning while the giant boulder is on', () => {
  const g = startBig([kid()]);
  avalanche.spawn = 0;
  step(g, 4);
  assert.equal(avalanche.rocks.length, 0);
});

test('avalanche: giant boulder, a kid in the gap gets +3, one outside gets nothing and costs no hearts', () => {
  const a = kid({ id: 1, x: 500 });
  const b = kid({ id: 2, x: 500 });
  const g = startBig([a, b]);
  avalanche.big.gapX = 600;
  b.cx = 1500;
  step(g, BIG_WARN + BIG_FALL + 0.25);
  assert.equal(a.score, 3);
  assert.equal(b.score, 0);
  assert.equal(g.team.hearts, 5);
  assert.equal(g.levelEnd, null);
  assert.ok(avalanche.feedback.some((f) => f.text === 'SPLAT!'));
  assert.ok(!avalanche.feedback.some((f) => f.text === 'EVERYONE MADE IT!'));
});

test('avalanche: giant boulder, everyone in the gap triggers the team cheer', () => {
  const a = kid({ id: 1, x: 500 });
  const b = kid({ id: 2, x: 600 });
  const g = startBig([a, b]);
  avalanche.big.gapX = 550;
  step(g, BIG_WARN + BIG_FALL + 0.25);
  assert.deepEqual([a.score, b.score], [3, 3]);
  assert.ok(avalanche.feedback.some((f) => f.text === 'EVERYONE MADE IT!'));
});

test('avalanche: giant boulder never ends the level, even when everyone is outside and on 1 heart', () => {
  const a = kid({ id: 1, x: 100 });
  const g = startBig([a]);
  g.team.hearts = 1;
  avalanche.big.gapX = 1700;
  step(g, 8);
  assert.equal(g.levelEnd, null);
  assert.equal(g.team.hearts, 1);
  assert.equal(a.score, 0);
  assert.equal(avalanche.big, null, 'it is over after the dust settles');
  step(g, 2);
  assert.equal(avalanche.big, null, 'only one giant boulder per level');
});

test('avalanche: giant boulder is judged once', () => {
  const a = kid({ id: 1, x: 500 });
  const g = startBig([a]);
  avalanche.big.gapX = 500;
  step(g, 6);
  assert.equal(a.score, 3);
});

test('avalanche: pure helpers', () => {
  assert.ok(rockGap({ x: 0, y: 0, r: 50 }, [{ x: 200, y: 0, r: 50 }]) === 200 - 90);
  assert.ok(shadowGrow(-120, 1080) < shadowGrow(900, 1080));
  assert.ok(shadowGrow(5000, 1080) <= 1);
});

test('avalanche: a boulder rolling all the way across judges a kid exactly once', () => {
  const p = kid();
  const g = setup([p]);
  g.now = 10;
  avalanche.boulders = [{ dir: 1, t: 0, x: -999, rot: 0, judged: new Map() }];
  for (let i = 0; i < 60 * 3.2; i++) {
    g.now += 1 / 60;
    if (!avalanche.boulders[0]?.judged.size) p.lastJump = g.now; // jumps as it arrives, then lands
    avalanche.update(g, 1 / 60);
  }
  assert.equal(p.score, 1);
});
