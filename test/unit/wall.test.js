// Unit tests for Hole in the wall, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import wall, { POSES, wallTime, isSafe, wallScale } from '../../src/levels/wall.js';

const DT = 1 / 60;

function makeG(players = []) {
  return {
    W: 1920,
    H: 1080,
    u: 1,
    now: 0,
    diff: 1,
    players,
    levelEnd: null,
    endCalls: 0,
    bursts: 0,
    activePlayers() {
      return this.players.filter((p) => p.present);
    },
    score(p, pts) {
      if (p) p.score += pts;
    },
    burst() {
      this.bursts++;
    },
    endLevel(msg) {
      this.endCalls++;
      this.levelEnd = msg;
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
    color: '#f00',
    shoulderW: 100,
    sh: { x, y: 600 },
    hip: { x, y: 800 },
    px: Array.from({ length: 33 }, () => ({ x, y: 500 })),
    pose: { armsUp: false, airplane: false, handsHead: false },
    ...over,
  };
}

function step(g, n = 1) {
  for (let i = 0; i < n; i++) {
    g.now += DT;
    wall.update(g, DT);
  }
}

// Run until the wall is about to arrive: the next step() will judge. Returns once t is within one frame.
function toArrival(g, each) {
  let guard = 0;
  while (wall.phase !== 'coming') {
    step(g);
    assert.ok(++guard < 600, 'a wall should start');
  }
  guard = 0;
  while (wall.time - wall.t > 1.5 * DT) {
    each?.(wall.time - wall.t);
    step(g);
    assert.ok(++guard < 1000);
  }
  each?.(wall.time - wall.t);
}

// Step until the wall has been judged (at most 2 frames after toArrival).
function judge(g) {
  for (let i = 0; i < 3 && wall.phase === 'coming'; i++) step(g);
  assert.equal(wall.phase, 'gone');
}

const setPose = (p, key, on = true) => {
  for (const k of Object.keys(p.pose)) p.pose[k] = false;
  if (on) p.pose[key] = true;
};

function begin(players) {
  const g = makeG(players);
  wall.start(g);
  return g;
}

test('wall: has the level interface', () => {
  assert.equal(wall.id, 'wall');
  assert.equal(wall.title, 'Hole in the wall!');
  assert.equal(wall.color, '#ff9ad5');
  assert.equal(wall.duration, 40);
  assert.equal(typeof wall.hint, 'string');
  for (const f of ['start', 'update', 'draw']) assert.equal(typeof wall[f], 'function');
});

test('wall: timing gets quicker but never below the floor, and g.diff speeds it up', () => {
  assert.ok(Math.abs(wallTime(0) - 3.2) < 1e-9);
  assert.ok(wallTime(3) < wallTime(0));
  assert.ok(wallTime(1000) >= 2.2 && wallTime(1000) < 2.3);
  assert.ok(wallTime(0, 1.5) < wallTime(0, 1));
  assert.ok(wallScale(0) < 0.3 && wallScale(1) === 1 && wallScale(0.5) < wallScale(0.8));
});

test('wall: the judging rule is pose-now OR enough pose-time in the window', () => {
  assert.equal(isSafe(true, 0), true);
  assert.equal(isSafe(false, 0.3), true);
  assert.equal(isSafe(false, 0.29), false);
  assert.equal(isSafe(undefined, 0), false);
});

test('wall: holding the right pose when the wall arrives scores 2 and shows WHOOSH', () => {
  const p = kid();
  const g = begin([p]);
  toArrival(g, () => setPose(p, wall.cur.key));
  judge(g);
  assert.equal(p.score, 2);
  assert.match(wall.feedback[0].text, /WHOOSH/);
  assert.match(wall.feedback[0].text, /✓/);
  assert.equal(p.flashColor, '#4dff88');
  assert.ok(p.flashUntil > g.now);
});

test('wall: the wrong pose scores 0 and shows BONK with a red flash', () => {
  const p = kid();
  const g = begin([p]);
  toArrival(g, () => {
    const other = POSES.find((q) => q !== wall.cur).key;
    setPose(p, other);
  });
  judge(g);
  assert.equal(p.score, 0);
  assert.equal(wall.feedback.length, 1);
  assert.match(wall.feedback[0].text, /BONK/);
  assert.equal(p.flashColor, '#ff5a5a');
  assert.ok(g.bursts > 0, 'foam');
});

test('wall: no pose at all is a BONK too', () => {
  const p = kid();
  const g = begin([p]);
  toArrival(g);
  judge(g);
  assert.equal(p.score, 0);
  assert.match(wall.feedback[0].text, /BONK/);
});

test('wall: a pose held just before arrival but flickering off at the exact frame still counts', () => {
  const p = kid();
  const g = begin([p]);
  toArrival(g, (left) => setPose(p, wall.cur.key, left > 0.1 && left < 0.5)); // on for 0.4 s, off for the last 0.1 s
  assert.equal(p.pose[wall.cur.key], false);
  judge(g);
  assert.equal(p.score, 2);
  assert.match(wall.feedback[0].text, /WHOOSH/);
});

test('wall: a pose held only long before the window does not count', () => {
  const p = kid();
  const g = begin([p]);
  toArrival(g, (left) => setPose(p, wall.cur.key, left > 1.5)); // on early, off for the final 1.5 s
  judge(g);
  assert.equal(p.score, 0);
  assert.match(wall.feedback[0].text, /BONK/);
});

test('wall: a blip shorter than the forgiving amount, off at arrival, is a BONK', () => {
  const p = kid();
  const g = begin([p]);
  toArrival(g, (left) => setPose(p, wall.cur.key, left > 0.5 && left < 0.65)); // 0.15 s only
  judge(g);
  assert.equal(p.score, 0);
});

test('wall: each kid is judged separately and only once per wall', () => {
  const a = kid({ id: 1, x: 500 });
  const b = kid({ id: 2, x: 1400 });
  const g = begin([a, b]);
  toArrival(g, () => {
    setPose(a, wall.cur.key);
    setPose(b, wall.cur.key, false);
  });
  judge(g);
  assert.deepEqual([a.score, b.score], [2, 0]);
  assert.equal(wall.feedback.length, 2);
  // keep playing through the fade-out and the gap, still posing: nothing more is awarded for this wall
  step(g, 30);
  assert.equal(a.score, 2);
  assert.equal(wall.feedback.filter((f) => /WHOOSH/.test(f.text)).length, 1);
});

test('wall: kids who sat out are not judged', () => {
  const a = kid({ id: 1 });
  const b = kid({ id: 2, present: false });
  const g = begin([a, b]);
  toArrival(g);
  judge(g);
  assert.equal(wall.feedback.length, 1);
});

test('wall: consecutive walls never repeat a pose', () => {
  const p = kid();
  const g = begin([p]);
  const seen = [];
  let lastN = 0;
  for (let i = 0; i < 60 * 300 && seen.length < 40; i++) {
    step(g);
    if (wall.phase === 'coming' && wall.n !== lastN) {
      lastN = wall.n;
      seen.push(wall.cur.key);
    }
  }
  assert.ok(seen.length >= 40);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  assert.ok(new Set(seen).size === 3, 'all three poses turn up');
});

test('wall: there is a gap between walls and walls get quicker', () => {
  const g = begin([kid()]);
  const times = [];
  let last = null;
  let sawGap = false;
  for (let i = 0; i < 60 * 60 && times.length < 6; i++) {
    step(g);
    if (wall.phase === 'gap' && last) sawGap = true;
    if (wall.phase === 'coming' && wall.cur !== last) {
      if (last) assert.ok(sawGap, 'a gap before the next wall');
      sawGap = false;
      last = wall.cur;
      times.push(wall.time);
    }
  }
  assert.ok(times.length >= 6);
  assert.ok(times[5] < times[0]);
});

test('wall: draws without throwing in every phase', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => calls.push([k, a])),
      set: () => true,
    },
  );
  const g = begin([kid({ id: 1 }), kid({ id: 2, x: 300 })]);
  for (let i = 0; i < 60 * 15; i++) {
    step(g);
    wall.draw(g, ctx);
  }
  assert.ok(calls.length > 100);
});

test('wall: survives 50 s at 60 fps with no players, 3 players and players coming and going, and never ends the level', () => {
  const g = makeG([]);
  wall.start(g);
  for (let i = 0; i < 60 * 50; i++) {
    if (i === 300) g.players = [kid({ id: 1, x: 300 }), kid({ id: 2, x: 960 }), kid({ id: 3, x: 1700 })];
    if (i === 1500) g.players = [g.players[1], kid({ id: 4, x: 1200 })];
    if (i === 2400) g.players = [];
    for (const p of g.players) setPose(p, POSES[Math.floor(i / 50) % 3].key, i % 7 < 4);
    if (i === 1700) g.players[0].present = false;
    step(g);
    wall.draw(g, new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true }));
  }
  assert.equal(g.endCalls, 0);
  assert.equal(g.levelEnd, null);
});
