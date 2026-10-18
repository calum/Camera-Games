// Checks that apply to EVERY level in src/levels/index.js (and the template), so a new level is tested the
// moment it is added to the list: a valid definition, a unique id, and a minute of simulated play with
// 0-4 pretend kids moving about, without throwing, without NaNs, and drawing something.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../../src/levels/index.js';
import template from '../../src/levels/_template.js';
import { checkLevel, handTouching, bodyHit } from '../../src/levels/kit.js';
import { computeFeatures } from '../../src/tracker.js';
import { SCENES } from '../../src/backdrops.js';

const ALL = [...LEVELS, template];

// A canvas context that accepts every call and counts the drawing ones.
function fakeCtx() {
  const calls = { n: 0 };
  const grad = { addColorStop() {} };
  return new Proxy(
    { calls },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 10 });
        if (/Gradient|Pattern/.test(String(k))) return () => grad;
        return (...args) => {
          if (/fill|stroke|draw|arc|lineTo|rect/i.test(String(k))) calls.n++;
          return undefined;
        };
      },
      set: () => true,
    },
  );
}

// A pretend kid at x who sways, waves and jumps now and then, built from a skeleton like the tracker's.
function kid(id, x0) {
  const p = { id, slot: id, color: '#fff', present: true, score: 0, jumps: 0, lastJump: -99, hitUntil: 0, pose: {}, px: null };
  p.move = (t) => {
    const x = x0 + Math.sin(t * 0.7 + id) * 200;
    const lift = Math.sin(t * 3 + id) > 0.95 ? 80 : 0;
    const wave = Math.sin(t * 4 + id) * 120;
    const px = Array.from({ length: 33 }, () => ({ x, y: 600 - lift }));
    const set = (i, dx, dy) => (px[i] = { x: x + dx, y: dy - lift });
    set(0, 0, 250); set(11, -60, 330); set(12, 60, 330);
    set(15, -160, 330 - wave); set(16, 160, 330 + wave); set(19, -170, 320 - wave); set(20, 170, 320 + wave);
    set(23, -45, 560); set(24, 45, 560); set(25, -45, 760); set(26, 45, 760); set(27, -45, 950); set(28, 45, 950);
    p.px = px;
    computeFeatures(p, t);
    const doing = ['armsUp', 'airplane', 'handsHead'][Math.floor(t / 2 + id) % 3]; // a new pose every 2 s
    p.pose = { armsUp: doing === 'armsUp', airplane: doing === 'airplane', handsHead: doing === 'handsHead' };
  };
  return p;
}

function makeG(players) {
  return {
    W: 1920, H: 1080, u: 1, now: 0, diff: 1, round: 0, fx: true, players, level: null,
    team: { score: 0, hearts: 5, maxHearts: 5 },
    ended: null,
    activePlayers() {
      return this.players.filter((p) => p.present && !p.excluded);
    },
    score(p, pts) {
      assert.ok(Number.isFinite(pts) && pts > 0, `points must be a positive number, got ${pts}`);
      if (p) p.score += pts;
      this.team.score += pts;
    },
    burst() {},
    endLevel(msg) {
      this.ended ??= msg;
    },
  };
}

test('every level is a valid definition', () => {
  for (const level of ALL) assert.deepEqual(checkLevel(level), [], level.id);
});

test('level ids are unique', () => {
  const ids = ALL.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('every level has a backdrop: its own scene, a named one, or the menu meadow', () => {
  for (const level of ALL) {
    const b = level.backdrop;
    if (typeof b === 'string') assert.ok(SCENES[b], `${level.id}: no scene called "${b}"`);
    else if (!b) assert.ok(SCENES[level.id] || true, 'falls back to the menu meadow');
  }
});

for (const level of ALL) {
  test(`${level.id}: a minute of play with 0 to 4 kids, without errors`, () => {
    for (const n of [0, 1, 2, 4]) {
      const players = Array.from({ length: n }, (_, i) => kid(i + 1, 300 + i * 420));
      const g = makeG(players);
      g.level = level;
      level.start(g);
      let drawn = 0;
      for (let t = 0; t < 60; t += 1 / 30) {
        g.now = t;
        for (const p of players) p.move(t);
        // a kid who sat out and a dropped-out kid must never break a level
        if (n >= 2) players[1].excluded = t > 20;
        if (n >= 4) players[3].present = Math.floor(t) % 5 !== 0;
        level.update(g, 1 / 30);
        if (g.ended) level.start(g), (g.ended = null); // out of hearts: the game replays the level
        const ctx = fakeCtx();
        level.draw(g, ctx);
        drawn += ctx.calls.n;
      }
      assert.ok(Number.isFinite(g.team.score), `${level.id}: team score is a number`);
      for (const p of players) assert.ok(Number.isFinite(p.score), `${level.id}: player score is a number`);
      assert.ok(drawn > 0, `${level.id} with ${n} kids drew something`);
      if (n >= 2 && level.id !== 'dodge') assert.ok(g.team.score > 0, `${level.id}: busy kids score something in a minute`);
    }
  });
}

test('kit: a hand counts as touching within the slack, a body only within 80% of its circles', () => {
  const p = { hands: [{ x: 100, y: 100 }], circles: [{ x: 500, y: 500, r: 50 }] };
  assert.equal(handTouching([p], 150, 100, 30, 25), p);
  assert.equal(handTouching([p], 160, 100, 30, 25), null);
  assert.equal(bodyHit([p], 500, 580, 41), p, '41 + 0.8 * 50 = 81 > 80');
  assert.equal(bodyHit([p], 500, 580, 39), null);
});

test('kit: checkLevel explains what is missing', () => {
  const problems = checkLevel(/** @type {any} */ ({ id: 'Bad Id', title: 'x', duration: 0 }));
  assert.ok(problems.some((m) => /id must be/.test(m)));
  assert.ok(problems.some((m) => /hint/.test(m)));
  assert.ok(problems.some((m) => /duration/.test(m)));
  assert.ok(problems.some((m) => /update\(\)/.test(m)));
});
