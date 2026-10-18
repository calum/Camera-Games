// Unit tests for the level rules, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../../src/levels/index.js';

const byId = (id) => LEVELS.find((l) => l.id === id);
const [bubbles, dodge, jump, dance] = ['bubbles', 'dodge', 'jump', 'dance'].map(byId);

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
    bursts: 0,
    activePlayers() {
      return this.players.filter((p) => p.present);
    },
    score(p, pts) {
      if (p) p.score += pts;
      this.team.score += pts;
    },
    burst() {
      this.bursts++;
    },
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
    torso: 200,
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

test('there are four levels, each with the full interface', () => {
  assert.equal(LEVELS.length, 11);
  for (const L of LEVELS) {
    assert.equal(typeof L.start, 'function', L.id);
    assert.equal(typeof L.update, 'function', L.id);
    assert.equal(typeof L.draw, 'function', L.id);
    assert.ok(L.title && L.hint && L.duration > 0, L.id);
  }
});

test('every level survives a long run with no players, 3 players and mid-run player changes', () => {
  for (const L of LEVELS) {
    const g = makeG([]);
    L.start(g);
    for (let i = 0; i < 60 * 40; i++) {
      g.now += 1 / 60;
      if (i === 600) g.players = [kid({ id: 1, x: 400 }), kid({ id: 2, x: 960 }), kid({ id: 3, x: 1500 })];
      if (i === 1500) g.players = [g.players[0]];
      L.update(g, 1 / 60);
    }
  }
});

test('bubbles: touching a bubble with a hand pops it and scores 1 (gold = 3)', () => {
  const g = makeG([kid({ hands: [{ x: 500, y: 500 }] })]);
  bubbles.start(g);
  bubbles.spawn = 999;
  const mk = (gold) => ({ x0: 500, x: 500, y: 500, r: 60, vy: 0, amp: 0, f: 1, ph: 0, gold });
  bubbles.items = [mk(false)];
  bubbles.update(g, 0.016);
  assert.equal(g.players[0].score, 1);
  assert.equal(bubbles.items.length, 0);

  bubbles.items = [mk(true)];
  bubbles.update(g, 0.016);
  assert.equal(g.players[0].score, 4);
  assert.equal(g.team.score, 4);
});

test('bubbles: a bubble out of reach is not popped, and escaped bubbles are removed', () => {
  const g = makeG([kid({ hands: [{ x: 100, y: 100 }] })]);
  bubbles.start(g);
  bubbles.spawn = 999;
  bubbles.items = [
    { x0: 900, x: 900, y: 600, r: 60, vy: 0, amp: 0, f: 1, ph: 0, gold: false },
    { x0: 900, x: 900, y: -500, r: 60, vy: 0, amp: 0, f: 1, ph: 0, gold: false },
  ];
  bubbles.update(g, 0.016);
  assert.equal(g.team.score, 0);
  assert.equal(bubbles.items.length, 1);
});

test('bubbles: the kid who touches it gets the points, not the others', () => {
  const a = kid({ id: 1, hands: [{ x: 100, y: 100 }] });
  const b = kid({ id: 2, hands: [{ x: 500, y: 500 }] });
  const g = makeG([a, b]);
  bubbles.start(g);
  bubbles.spawn = 999;
  bubbles.items = [{ x0: 500, x: 500, y: 500, r: 60, vy: 0, amp: 0, f: 1, ph: 0, gold: false }];
  bubbles.update(g, 0.016);
  assert.deepEqual([a.score, b.score], [0, 1]);
});

test('dodge: a rock hitting a kid costs one heart, with brief invulnerability', () => {
  const p = kid();
  const g = makeG([p]);
  dodge.start(g);
  dodge.spawn = 999;
  const rock = () => ({ x: 960, y: 500, r: 50, vy: 0, warn: 0, rot: 0, spin: 0 });
  dodge.rocks = [rock(), rock()]; // two rocks arrive in the same instant
  dodge.update(g, 0.016);
  assert.equal(g.team.hearts, 4, 'only one heart lost despite two rocks');
  assert.ok(p.hitUntil > g.now);
});

test('dodge: a warning rock cannot hurt anyone yet', () => {
  const g = makeG([kid()]);
  dodge.start(g);
  dodge.spawn = 999;
  dodge.rocks = [{ x: 960, y: 500, r: 50, vy: 0, warn: 0.5, rot: 0, spin: 0 }];
  dodge.update(g, 0.016);
  assert.equal(g.team.hearts, 5);
});

test('dodge: a rock that misses lands for a team point; losing all hearts ends the level', () => {
  const g = makeG([kid({ x: 200, circles: [{ x: 200, y: 500, r: 50 }] })]);
  dodge.start(g);
  dodge.spawn = 999;
  dodge.rocks = [{ x: 1500, y: 1200, r: 50, vy: 100, warn: 0, rot: 0, spin: 0 }];
  dodge.update(g, 0.016);
  assert.equal(g.team.score, 1);

  g.team.hearts = 1;
  dodge.rocks = [{ x: 200, y: 500, r: 50, vy: 0, warn: 0, rot: 0, spin: 0 }];
  dodge.invul = 0;
  dodge.update(g, 0.016);
  assert.equal(g.team.hearts, 0);
  assert.ok(g.levelEnd, 'level ends when hearts run out');
});

// Simulate a left-to-right wave (~1390 px/s) with the kid standing at x=960 making ONE jump
// at the moment the wave is `offset` px from them (negative = before it arrives, positive = after
// it passed). offset=null means the kid never jumps.
function runWave({ offset }) {
  const p = kid({ x: 960 });
  const g = makeG([p]);
  jump.start(g);
  jump.next = 999;
  jump.waves = [{ dir: 1, t: -0.01, x: -999, judged: new Map(), tick: 4 }];
  let jumped = false;
  for (let i = 0; i < 60 * 4; i++) {
    g.now += 1 / 60;
    const w = jump.waves[0];
    if (!jumped && offset !== null && w && w.t >= 0 && w.x >= 960 + offset) {
      p.lastJump = g.now;
      jumped = true;
    }
    jump.update(g, 1 / 60);
  }
  return p.score;
}

test('jump: jumping as the wave passes scores 1 point', () => {
  assert.equal(runWave({ offset: 0 }), 1);
});

test('jump: jumping a little early (0.3s) or a little late (0.07s) still counts', () => {
  assert.equal(runWave({ offset: -400 }), 1);
  assert.equal(runWave({ offset: 100 }), 1);
});

test('jump: not jumping scores nothing and never crashes', () => {
  assert.equal(runWave({ offset: null }), 0);
});

test('jump: jumping far too early (0.7s) or far too late (0.4s) does not count', () => {
  assert.equal(runWave({ offset: -1000 }), 0);
  assert.equal(runWave({ offset: 600 }), 0);
});

// Run a wave past a kid and return what the kid saw on screen (feedback message + flash).
function runWaveFeedback(offset) {
  const p = kid({ x: 960 });
  const g = makeG([p]);
  jump.start(g);
  jump.next = 999;
  jump.waves = [{ dir: 1, t: -0.01, x: -999, judged: new Map(), tick: 4 }];
  let jumped = false;
  let seen = null;
  for (let i = 0; i < 60 * 4; i++) {
    g.now += 1 / 60;
    const w = jump.waves[0];
    if (!jumped && offset !== null && w && w.t >= 0 && w.x >= 960 + offset) {
      p.lastJump = g.now;
      jumped = true;
    }
    jump.update(g, 1 / 60);
    if (!seen && jump.feedback.length) seen = { ...jump.feedback[0], flashColor: p.flashColor, flashing: p.flashUntil > g.now };
  }
  return { seen, leftover: jump.feedback.length };
}

test('jump feedback: a good jump shows a big green "NICE JUMP" and flashes the skeleton green', () => {
  const { seen } = runWaveFeedback(0);
  assert.equal(seen.ok, true);
  assert.match(seen.text, /NICE JUMP/);
  assert.equal(seen.color, '#4dff88');
  assert.equal(seen.flashing, true);
  assert.equal(seen.flashColor, '#4dff88');
});

test('jump feedback: no jump shows a red "SPLASH" with a hint and flashes the skeleton red', () => {
  const { seen } = runWaveFeedback(null);
  assert.equal(seen.ok, false);
  assert.match(seen.text, /SPLASH/);
  assert.ok(seen.sub, 'tells the kid what to do');
  assert.equal(seen.flashColor, '#ff5a5a');
});

test('jump feedback: jumping too early says "TOO EARLY"', () => {
  const { seen } = runWaveFeedback(-1000);
  assert.equal(seen.ok, false);
  assert.match(seen.text, /TOO EARLY/);
});

test('jump feedback: messages disappear again after a moment', () => {
  const { leftover } = runWaveFeedback(0);
  assert.equal(leftover, 0);
});

test('jump feedback: every kid gets their own message over their own head', () => {
  const left = kid({ id: 1, x: 400 });
  const right = kid({ id: 2, x: 1500 });
  const g = makeG([left, right]);
  jump.start(g);
  jump.next = 999;
  jump.waves = [{ dir: 1, t: -0.01, x: -999, judged: new Map(), tick: 4 }];
  const all = [];
  for (let i = 0; i < 60 * 4; i++) {
    g.now += 1 / 60;
    const w = jump.waves[0];
    if (w && w.t >= 0 && Math.abs(w.x - 400) < 100) left.lastJump = g.now;
    jump.update(g, 1 / 60);
    for (const f of jump.feedback) if (!all.includes(f)) all.push(f);
  }
  assert.equal(all.length, 2);
  const [a, b] = all.sort((m, n) => m.x - n.x);
  assert.deepEqual([a.x, a.ok, b.x, b.ok], [400, true, 1500, false]);
});

test('dodge: rocks fall at a gentler speed than the first version (max 600 px/s at 1080p)', () => {
  const g = makeG([kid()]);
  dodge.start(g);
  dodge.spawn = 0;
  const speeds = [];
  for (let i = 0; i < 400; i++) {
    dodge.rocks = [];
    dodge.spawn = 0;
    dodge.update(g, 0.001);
    speeds.push(...dodge.rocks.map((r) => r.vy));
  }
  assert.ok(speeds.length > 200);
  assert.ok(Math.max(...speeds) <= 600, `fastest rock ${Math.max(...speeds).toFixed(0)}px/s`);
  assert.ok(Math.min(...speeds) >= 400, 'but still a real challenge');
});

test('jump: each kid is judged separately', () => {
  const left = kid({ id: 1, x: 400 });
  const right = kid({ id: 2, x: 1500 });
  const g = makeG([left, right]);
  jump.start(g);
  jump.next = 999;
  jump.waves = [{ dir: 1, t: -0.01, x: -999, judged: new Map(), tick: 4 }];
  for (let i = 0; i < 60 * 4; i++) {
    g.now += 1 / 60;
    const w = jump.waves[0];
    if (w && w.t >= 0 && Math.abs(w.x - 400) < 100) left.lastJump = g.now; // only the left kid jumps
    jump.update(g, 1 / 60);
  }
  assert.deepEqual([left.score, right.score], [1, 0]);
});

test('dance: holding the target pose scores once per round; the wrong pose scores nothing', () => {
  const right = kid({ id: 1 });
  const wrong = kid({ id: 2 });
  const g = makeG([right, wrong]);
  dance.start(g);
  const key = dance.cur.key;
  const other = ['armsUp', 'airplane', 'handsHead'].find((k) => k !== key);
  right.pose = { [key]: true };
  wrong.pose = { [other]: true };
  for (let i = 0; i < 60 * 3; i++) {
    g.now += 1 / 60;
    dance.update(g, 1 / 60);
    if (dance.round > 0) break;
  }
  assert.equal(right.score, 3, 'scored exactly once');
  assert.equal(wrong.score, 0);
});

test('dance: a pose held for too short a time does not score', () => {
  const p = kid();
  const g = makeG([p]);
  dance.start(g);
  p.pose = { [dance.cur.key]: true };
  for (let i = 0; i < 20; i++) dance.update(g, 1 / 60); // ~0.33s < 0.9s
  assert.equal(p.score, 0);
});

test('dance: rounds advance and the next pose differs from the last', () => {
  const g = makeG([kid()]);
  dance.start(g);
  const seen = [dance.cur.key];
  for (let i = 0; i < 60 * 14; i++) {
    const before = dance.round;
    g.now += 1 / 60;
    dance.update(g, 1 / 60);
    if (dance.round !== before) seen.push(dance.cur.key);
  }
  assert.ok(seen.length >= 3);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
});

test('levels are looked up by id', () => {
  assert.equal(byId('jump'), jump);
});
