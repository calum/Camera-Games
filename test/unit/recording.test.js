// Debug recordings (recording.js) and playing them back (replay.js). The last test plays every recording in
// test/fixtures/recordings/ through the real tracking code: a clip a grown-up saved of something going wrong
// becomes a regression test by dropping it in that folder with an `expect` (see the README there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

globalThis.document ??= /** @type {any} */ ({ createElement: () => ({ play: async () => {}, srcObject: null, videoWidth: 1280, videoHeight: 720 }) });
const { Recorder, packLandmarks, unpackLandmarks, parseRecording, recordingStart, recordingName, RECORDING_KIND } = await import('../../src/recording.js');
const { playRecording } = await import('../../src/replay.js');

// A standing kid in camera coordinates (0..1), centred on cx
function kid(cx, { arms = 'down' } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, visibility: 0.9 }));
  const set = (i, x, y) => (lm[i] = { x, y, visibility: 0.9 });
  set(0, cx, 0.2);
  set(11, cx - 0.05, 0.3);
  set(12, cx + 0.05, 0.3);
  set(23, cx - 0.035, 0.45);
  set(24, cx + 0.035, 0.45);
  set(25, cx - 0.035, 0.6);
  set(26, cx + 0.035, 0.6);
  set(27, cx - 0.035, 0.75);
  set(28, cx + 0.035, 0.75);
  const handY = arms === 'up' ? 0.08 : 0.42;
  const handX = arms === 'up' ? 0.04 : 0.07;
  for (const [i, s] of [[13, -1], [15, -1], [17, -1], [19, -1], [21, -1], [14, 1], [16, 1], [18, 1], [20, 1], [22, 1]]) {
    set(i, cx + s * (i <= 14 ? 0.06 : handX), i <= 14 ? (arms === 'up' ? 0.18 : 0.38) : handY);
  }
  return lm;
}

// A recording of `seconds` at 30 tracked frames a second; bodies(t) says who is in view
function clip(seconds, bodies) {
  const r = new Recorder();
  for (let t = 10; t < 10 + seconds; t += 1 / 30) r.frame(t, bodies(t - 10), [], 1280, 720);
  r.sample(10, { state: 'play', level: 'bubbles', levelT: 4 });
  return JSON.parse(JSON.stringify(r.toFile({ test: true })));
}

test('landmarks are packed to 3 rounded numbers each and come back the same', () => {
  const lm = kid(0.5);
  const flat = packLandmarks(lm);
  assert.equal(flat.length, 99);
  const back = unpackLandmarks(flat);
  back.forEach((l, i) => {
    assert.ok(Math.abs(l.x - lm[i].x) < 1e-4 && Math.abs(l.y - lm[i].y) < 1e-4);
    assert.equal(l.visibility, 0.9);
  });
});

test('the recorder only keeps the last minute, so memory stays flat however long the game runs', () => {
  const r = new Recorder({ seconds: 60 });
  for (let t = 0; t < 300; t += 1 / 30) {
    r.frame(t, [kid(0.5)], [], 1280, 720);
    r.sample(t, { fps: 60 });
  }
  r.event(0, 'old');
  r.event(299, 'miss');
  assert.ok(r.frames.length <= 60 * 30 + 1 && r.frames.length >= 60 * 30 - 1, `${r.frames.length} frames`);
  assert.ok(r.frames[0].t >= 239);
  assert.deepEqual(r.events.map((e) => e.type), ['miss']);
  assert.ok(Math.abs(r.span - 60) < 0.1);
});

test('a saved recording reads back, and other files get a plain-word error', () => {
  const rec = parseRecording(JSON.stringify(clip(1, () => [kid(0.5)])));
  assert.equal(rec.kind, RECORDING_KIND);
  assert.deepEqual(recordingStart(rec), { state: 'play', level: 'bubbles', levelT: 4 });
  assert.throws(() => parseRecording('not json'), /not a game recording/);
  assert.throws(() => parseRecording('{"hello":1}'), /not a game recording/);
  // Saved before the rename to Camera Games: still loads.
  const old = parseRecording(JSON.stringify({ ...clip(1, () => [kid(0.5)]), kind: 'kids-camera-games-recording' }));
  assert.equal(old.frames.length, rec.frames.length);
  assert.match(recordingName(new Date(2026, 9, 18, 18, 5, 9)), /^camera-games-2026-10-18-180509$/);
});

test('a replay goes through the real who-is-who and pose code: a kid joins after probation and their arms-up registers', () => {
  const rec = clip(3, (t) => [kid(0.5, { arms: t > 1.5 ? 'up' : 'down' })]);
  const ticks = playRecording(rec, { tail: 0 });
  assert.equal(ticks[0].players.length, 0, 'on probation at first');
  const at = (t) => ticks.find((x) => x.t >= t).players;
  assert.equal(at(1).length, 1);
  assert.ok(!at(1)[0].pose.includes('armsUp'));
  assert.ok(at(2.5)[0].pose.includes('armsUp'), `pose at 2.5 s: ${at(2.5)[0].pose}`);
  assert.ok(Math.abs(at(2.5)[0].x - 960) < 30, 'mapped to the middle of a 1920 wide screen');
});

test('nothing pops in a replay: a short tracking dropout keeps the kid, a long absence loses them', () => {
  const rec = clip(6, (t) => (t > 2 && t < 2.4) || t > 4 ? [] : [kid(0.3)]);
  const ticks = playRecording(rec, { tail: 0 });
  const ids = (t) => ticks.find((x) => x.t >= t).players.map((p) => p.id);
  const id = ids(1.5)[0];
  assert.ok(id);
  for (const x of ticks.filter((x) => x.t > 1.5 && x.t < 4)) assert.deepEqual(x.players.map((p) => p.id), [id], `at ${x.t.toFixed(2)} s`);
  assert.deepEqual(ids(5.5), []);
});

test('every recording in test/fixtures/recordings plays through tracking as expected', () => {
  const dir = new URL('../fixtures/recordings/', import.meta.url);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  for (const f of files) {
    const rec = parseRecording(readFileSync(new URL(f, dir), 'utf8'));
    const ticks = playRecording(rec);
    const expect = rec.expect ?? {};
    const settled = ticks.filter((x) => x.t > 1 && x.t < ticks.at(-1).t - 1);
    if (expect.maxPlayers != null) {
      for (const x of settled) assert.ok(x.players.length <= expect.maxPlayers, `${f}: ${x.players.length} players at ${x.t.toFixed(2)} s`);
    }
    if (expect.players != null) {
      const right = settled.filter((x) => x.players.length === expect.players).length;
      assert.ok(right >= settled.length * 0.95, `${f}: ${expect.players} players only ${right} of ${settled.length} ticks`);
    }
    if (expect.ids != null) {
      const ids = new Set(ticks.flatMap((x) => x.players.map((p) => p.id)));
      assert.ok(ids.size <= expect.ids, `${f}: ${ids.size} different players (${[...ids]}), expected at most ${expect.ids}`);
    }
    if (expect.maxRise != null) {
      // nobody's shoulders move more than `maxRise` shoulder widths up or down within a quarter of a second:
      // an id that jumps from a standing kid to someone on the sofa has been given to the wrong body
      const window = Math.round(0.25 / (ticks[1].t - ticks[0].t));
      for (let i = window; i < ticks.length; i++)
        for (const p of ticks[i].players) {
          const was = ticks[i - window].players.find((q) => q.id === p.id);
          if (!was) continue;
          const rise = Math.abs(p.y - was.y) / Math.max(p.sw, was.sw);
          assert.ok(rise <= expect.maxRise, `${f}: player ${p.id} moved ${rise.toFixed(1)} shoulder widths up or down in 0.25 s at ${ticks[i].t.toFixed(2)} s`);
        }
    }
  }
});
