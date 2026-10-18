// Unit tests for Duck and jump! and Freeze!, driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import duckjump, { dodged } from '../../src/levels/duckjump.js';
import freeze, { isMoving } from '../../src/levels/freeze.js';

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
    sh: { x, y: 300 },
    hip: { x, y: 500 },
    px: Array.from({ length: 33 }, () => ({ x, y: 300 })),
    lastJump: -99,
    lastDuck: -99,
    motion: 0,
    pose: {},
    ...over,
  };
}

// Send one hazard left to right past kids standing at their x; `act(p, h)` is called each frame and can
// set the kid's move. Returns the kids.
function runHazard(kind, kids, act) {
  const g = makeG(kids);
  duckjump.start(g);
  duckjump.next = 999;
  duckjump.items = [{ kind, dir: 1, t: -0.01, x: -999, y: 0, judged: new Map() }];
  for (let i = 0; i < 60 * 4; i++) {
    g.now += 1 / 60;
    const h = duckjump.items[0];
    if (h && h.t >= 0) for (const p of kids) act(p, h, g);
    duckjump.update(g, 1 / 60);
  }
  return { g, kids };
}
const jumpAt = (offset) => (p, h, g) => {
  if (h.x >= p.cx + offset && h.x < p.cx + offset + 40) p.lastJump = g.now;
};
const duckAt = (offset) => (p, h, g) => {
  if (h.x >= p.cx + offset && h.x < p.cx + offset + 200) p.lastDuck = g.now; // ducking for a moment
};

test('duck and jump: jumping a log as it reaches you scores; ducking does not help', () => {
  assert.equal(runHazard('log', [kid()], jumpAt(0)).kids[0].score, 1);
  assert.equal(runHazard('log', [kid()], duckAt(-100)).kids[0].score, 0);
});

test('duck and jump: ducking under a bird scores; jumping does not help', () => {
  assert.equal(runHazard('bird', [kid()], duckAt(-100)).kids[0].score, 1);
  assert.equal(runHazard('bird', [kid()], jumpAt(0)).kids[0].score, 0);
});

test('duck and jump: doing nothing is a BONK with a hint, and never costs hearts or ends the level', () => {
  const { g, kids } = runHazard('bird', [kid()], () => {});
  assert.equal(kids[0].score, 0);
  assert.equal(g.team.hearts, 5);
  assert.equal(g.levelEnd, null);
  assert.equal(kids[0].flashColor, '#ff5a5a');
});

test('duck and jump: the window is forgiving but not endless', () => {
  const p = kid();
  p.lastJump = 9.6; // 0.4 s early
  assert.equal(dodged('log', p, 10), true);
  p.lastJump = 10.25;
  assert.equal(dodged('log', p, 10), true);
  p.lastJump = 9.3; // 0.7 s early
  assert.equal(dodged('log', p, 10), false);
  p.lastDuck = 9.7;
  assert.equal(dodged('bird', p, 10), true);
  p.lastDuck = undefined;
  assert.equal(dodged('bird', p, 10), false, 'a kid who never ducked');
});

test('duck and jump: each kid is judged on their own move', () => {
  const left = kid({ id: 1, x: 400 });
  const right = kid({ id: 2, x: 1500 });
  runHazard('log', [left, right], (p, h, g) => p.id === 1 && jumpAt(0)(p, h, g));
  assert.deepEqual([left.score, right.score], [1, 0]);
});

test('duck and jump: the first two are always logs, then birds turn up too', () => {
  const g = makeG([kid()]);
  let birds = 0;
  for (let run = 0; run < 30; run++) {
    duckjump.start(g);
    for (let n = 0; n < 6; n++) {
      duckjump.next = 0;
      duckjump.update(g, 0.001);
    }
    const kinds = duckjump.items.map((h) => h.kind);
    assert.deepEqual(kinds.slice(0, 2), ['log', 'log'], kinds.join(' '));
    birds += kinds.filter((k) => k === 'bird').length;
  }
  assert.ok(birds > 0);
});

// Freeze: run with kids whose motion is set by `motionAt(p, phase, t)` each frame.
function runFreeze(kids, seconds, motionAt) {
  const g = makeG(kids);
  freeze.start(g);
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.now += 1 / 60;
    for (const p of kids) p.motion = motionAt(p, freeze.phase, freeze.t);
    freeze.update(g, 1 / 60);
  }
  return g;
}

test('freeze: dancing while the music plays scores about a point a second; standing still does not', () => {
  const dancer = kid({ id: 1 });
  const statue = kid({ id: 2 });
  freeze.start(makeG());
  const g = makeG([dancer, statue]);
  freeze.start(g);
  freeze.timer = 99; // music all the way
  for (let i = 0; i < 60 * 5; i++) {
    g.now += 1 / 60;
    dancer.motion = 4;
    statue.motion = 0.2;
    freeze.update(g, 1 / 60);
  }
  assert.ok(dancer.score >= 4 && dancer.score <= 5, `dancer ${dancer.score}`);
  assert.equal(statue.score, 0);
});

test('freeze: staying still through a freeze earns 3; wobbling cracks the ice and earns nothing', () => {
  const still = kid({ id: 1 });
  const wobbly = kid({ id: 2 });
  const g = makeG([still, wobbly]);
  freeze.start(g);
  freeze.phase = 'freeze';
  freeze.timer = 3;
  freeze.t = 0;
  for (let i = 0; i < 60 * 3.1; i++) {
    g.now += 1 / 60;
    still.motion = 0.3; // tracking jitter
    wobbly.motion = 3;
    freeze.update(g, 1 / 60);
  }
  assert.equal(still.score, 3);
  assert.equal(wobbly.score, 0);
  assert.equal(freeze.phase, 'dance', 'the music came back');
});

test('freeze: coming to a stop just after FREEZE!, or one quick twitch, is forgiven', () => {
  const p = kid();
  const g = makeG([p]);
  freeze.start(g);
  freeze.phase = 'freeze';
  freeze.timer = 3;
  freeze.t = 0;
  for (let i = 0; i < 60 * 3.1; i++) {
    g.now += 1 / 60;
    // still moving for the first half second, then one 0.2 s twitch
    p.motion = freeze.t < 0.5 ? 5 : freeze.t > 1.5 && freeze.t < 1.7 ? 5 : 0.2;
    freeze.update(g, 1 / 60);
  }
  assert.equal(p.score, 3);
});

test('freeze: the music and the freeze take turns', () => {
  const phases = [];
  runFreeze([kid()], 40, (p, phase) => {
    if (phases[phases.length - 1] !== phase) phases.push(phase);
    return 0;
  });
  assert.ok(phases.length >= 6, phases.join(' '));
  assert.equal(phases[0], 'dance');
});

test('freeze: thresholds are separate for dancing and wobbling', () => {
  assert.equal(isMoving(kid({ motion: 1.3 }), 'dance'), false);
  assert.equal(isMoving(kid({ motion: 1.3 }), 'freeze'), true);
  assert.equal(isMoving(kid({ motion: undefined }), 'freeze'), false);
});
