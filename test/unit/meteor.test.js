// Unit tests for Catch the stars (meteor), driven with a fake game object and fake players (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import meteor, { meteorShare, spawnGap, isGoldStar, GOLD_EVERY } from '../../src/levels/meteor.js';

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

function kid(over = {}) {
  const x = over.x ?? 960;
  return {
    id: over.id ?? 1,
    present: true,
    score: 0,
    cx: x,
    hands: [{ x: -999, y: -999 }],
    circles: [{ x, y: 600, r: 50 }],
    hitUntil: 0,
    ...over,
  };
}

const star = (x, y, kind = 'star') => ({ kind, x0: x, x, y, r: 60, vy: 0, amp: 0, f: 1, ph: 0, rot: 0 });
const rock = (x, y, warn = 0) => ({ kind: 'meteor', x, y, r: 50, vy: 0, warn });

// A level with a hand-made item list and no random spawns.
function setup(players, items) {
  const g = makeG(players);
  meteor.start(g);
  meteor.spawn = 999;
  meteor.items = items;
  return g;
}
const step = (g, n = 1) => {
  for (let i = 0; i < n; i++) {
    g.now += 1 / 60;
    meteor.update(g, 1 / 60);
  }
};

test('meteor: has the full level interface', () => {
  assert.equal(meteor.id, 'meteor');
  assert.equal(meteor.title, 'Catch the stars!');
  assert.equal(meteor.color, '#ffd24d');
  assert.equal(meteor.duration, 40);
  assert.equal(meteor.hearts, true);
  for (const f of ['start', 'update', 'draw']) assert.equal(typeof meteor[f], 'function', f);
  assert.ok(meteor.hint);
});

test('meteor: survives 45 s with no players, 3 players and players changing', () => {
  const g = makeG([]);
  meteor.start(g);
  const ctx = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  for (let i = 0; i < 60 * 46; i++) {
    g.now += 1 / 60;
    if (i === 600) g.players = [kid({ id: 1, x: 400 }), kid({ id: 2, x: 960 }), kid({ id: 3, x: 1500 })];
    if (i === 1500) g.players = [g.players[0]];
    if (i === 2000) g.players = [];
    meteor.update(g, 1 / 60);
    if (i % 30 === 0) meteor.draw(g, ctx);
    g.team.hearts = 5; // keep it going; ending the level is tested separately
  }
});

test('meteor: a hand touching a star catches it for that kid only (+1)', () => {
  const a = kid({ id: 1, x: 400, hands: [{ x: 500, y: 300 }] });
  const b = kid({ id: 2, x: 1400 });
  const g = setup([a, b], [star(500, 300)]);
  step(g);
  assert.equal(a.score, 1);
  assert.equal(b.score, 0);
  assert.equal(g.team.score, 1);
  assert.equal(meteor.items.length, 0);
});

test('meteor: a golden star is worth 3, and only one kid gets it when two touch', () => {
  const a = kid({ id: 1, hands: [{ x: 500, y: 300 }] });
  const b = kid({ id: 2, hands: [{ x: 510, y: 300 }] });
  const g = setup([a, b], [star(500, 300, 'gold')]);
  step(g);
  assert.equal(a.score + b.score, 3);
  assert.equal(g.team.score, 3);
});

test('meteor: a star out of reach is not caught; reach is radius + 30', () => {
  const p = kid({ hands: [{ x: 500 + 60 + 40, y: 300 }] });
  const g = setup([p], [star(500, 300)]);
  step(g);
  assert.equal(p.score, 0);
  assert.equal(meteor.items.length, 1);
  p.hands = [{ x: 500 + 60 + 20, y: 300 }];
  step(g);
  assert.equal(p.score, 1);
});

test('meteor: a hand touching a meteor does nothing', () => {
  const p = kid({ hands: [{ x: 500, y: 300 }] });
  const g = setup([p], [rock(500, 300)]);
  step(g, 5);
  assert.equal(p.score, 0);
  assert.equal(g.team.score, 0);
  assert.equal(g.team.hearts, 5);
  assert.equal(meteor.items.length, 1);
});

test('meteor: a meteor hitting the body costs one heart; two at once cost only one', () => {
  const p = kid();
  const g = setup([p], [rock(960, 600)]);
  step(g);
  assert.equal(g.team.hearts, 4);
  assert.equal(meteor.items.length, 0);
  assert.ok(p.hitUntil > g.now);

  const q = kid();
  const g2 = setup([q], [rock(950, 600), rock(970, 600)]);
  step(g2);
  assert.equal(g2.team.hearts, 4);
  assert.equal(meteor.items.length, 1); // the second one flies on
});

test('meteor: after the invulnerability second, the next meteor hurts again', () => {
  const p = kid();
  const g = setup([p], [rock(960, 600)]);
  step(g);
  meteor.items = [rock(960, 600)];
  step(g);
  assert.equal(g.team.hearts, 4);
  step(g, 70); // > 1 s
  meteor.items = [rock(960, 600)];
  step(g);
  assert.equal(g.team.hearts, 3);
});

test('meteor: a warning meteor cannot hurt', () => {
  const p = kid();
  const g = setup([p], [rock(960, 600, 0.9)]);
  step(g, 10);
  assert.equal(g.team.hearts, 5);
  assert.equal(meteor.items.length, 1);
  assert.ok(meteor.items[0].warn > 0);
});

test('meteor: a warning turns into a falling meteor after about 0.9 s', () => {
  const g = setup([], [rock(960, -100, 0.9)]);
  meteor.items[0].vy = 300;
  step(g, 30);
  assert.equal(meteor.items[0].y, -100);
  step(g, 40);
  assert.ok(meteor.items[0].y > -100);
});

test('meteor: a meteor that lands safely gives the team 1 point and nobody a personal point', () => {
  const p = kid({ x: 200, circles: [{ x: 200, y: 600, r: 50 }] });
  const g = setup([p], [rock(1700, 1200)]);
  step(g);
  assert.equal(g.team.score, 1);
  assert.equal(p.score, 0);
  assert.equal(g.team.hearts, 5);
  assert.equal(meteor.items.length, 0);
});

test('meteor: a body circle is forgiving only up to 80% of its radius', () => {
  const p = kid({ circles: [{ x: 960, y: 600, r: 100 }] });
  // meteor r 50: hit distance is 50 + 80 = 130
  const g = setup([p], [rock(960 + 140, 600)]);
  step(g);
  assert.equal(g.team.hearts, 5);
  meteor.items = [rock(960 + 120, 600)];
  step(g);
  assert.equal(g.team.hearts, 4);
});

test('meteor: running out of hearts ends the level', () => {
  const p = kid();
  const g = setup([p], [rock(960, 600)]);
  g.team.hearts = 1;
  step(g);
  assert.equal(g.team.hearts, 0);
  assert.equal(g.levelEnd, 'Oh no, out of hearts! Try again!');
});

test('meteor: start() refills the hearts', () => {
  const g = makeG([]);
  g.team.hearts = 1;
  meteor.start(g);
  assert.equal(g.team.hearts, g.team.maxHearts);
});

test('meteor: stars that are missed drift away without costing anything', () => {
  const g = setup([kid()], [star(100, 1000)]);
  meteor.items[0].vy = 600;
  step(g, 60);
  assert.equal(meteor.items.length, 0);
  assert.equal(g.team.score, 0);
  assert.equal(g.team.hearts, 5);
});

test('meteor: every 8th star is golden', () => {
  assert.equal(GOLD_EVERY, 8);
  assert.deepEqual([1, 7, 8, 9, 16].map(isGoldStar), [false, false, true, false, true]);
  const g = makeG([]);
  meteor.start(g);
  const kinds = [];
  const orig = Math.random;
  Math.random = () => 0.99; // never a meteor
  try {
    for (let i = 0; i < 16; i++) {
      meteor.spawnItem(g, []);
      kinds.push(meteor.items.at(-1).kind);
    }
  } finally {
    Math.random = orig;
  }
  assert.deepEqual(kinds.map((k) => k === 'gold'), Array.from({ length: 16 }, (_, i) => i % 8 === 7));
});

test('meteor: stars fall slower than meteors and are big', () => {
  const g = makeG([]);
  meteor.start(g);
  const stars = [];
  const rocks = [];
  for (let i = 0; i < 400; i++) {
    meteor.items = [];
    meteor.spawnItem(g, []);
    const it = meteor.items[0];
    (it.kind === 'meteor' ? rocks : stars).push(it);
  }
  assert.ok(stars.length > 0 && rocks.length > 0);
  const normal = stars.filter((s) => s.kind === 'star');
  assert.ok(Math.max(...normal.map((s) => s.vy)) < Math.min(...rocks.map((r) => r.vy)));
  assert.ok(Math.min(...stars.map((s) => s.r)) >= 55);
});

test('meteor: the meteor share ramps up over the level but stays under 40%', () => {
  assert.ok(meteorShare(0) >= 0.19 && meteorShare(0) <= 0.21);
  assert.ok(meteorShare(40) > meteorShare(0));
  assert.ok(meteorShare(20) > meteorShare(5));
  for (const t of [0, 10, 20, 40, 100]) assert.ok(meteorShare(t) < 0.4, `t=${t}`);

  // and the spawner really follows it
  const share = (elapsed) => {
    const g = makeG([]);
    meteor.start(g);
    meteor.elapsed = elapsed;
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      meteor.items = [];
      meteor.spawnItem(g, []);
      if (meteor.items[0].kind === 'meteor') n++;
    }
    return n / 4000;
  };
  const early = share(0);
  const late = share(40);
  assert.ok(late > early + 0.07, `early ${early} late ${late}`);
  assert.ok(late < 0.4 && early > 0.14);
});

test('meteor: more kids and higher difficulty spawn faster', () => {
  assert.ok(spawnGap(4, 1) < spawnGap(1, 1));
  assert.ok(spawnGap(1, 2) < spawnGap(1, 1));
  assert.ok(spawnGap(100, 5) > 0);
});
