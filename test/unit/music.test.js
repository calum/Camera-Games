import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, SILENT_LEVELS, LEVEL, FAMILY, DUCK, HOLD, RELEASE, moodFor, songFor, barNotes, barSeconds, duckGain, hz, rms, musicOn, saveMusicOn } from '../../src/music.js';
import { LEVELS } from '../../src/levels/index.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

test('the menu and the picker share a song, every level has its own, Freeze! keeps its own tune', () => {
  assert.equal(moodFor('menu', null), 'menu');
  assert.equal(moodFor('pick', null), 'menu');
  assert.equal(moodFor('calibrate', null), 'menu', 'no gap between joining and the picker');
  for (const s of ['loading', 'setup', 'outro']) assert.equal(moodFor(s, 'jump'), null, `${s} is quiet`);
  assert.equal(moodFor('play', 'freeze'), null, 'other music would spoil "freeze when the music stops"');
  const tunes = new Set();
  for (const l of LEVELS) {
    if (SILENT_LEVELS.has(l.id)) continue;
    assert.equal(moodFor('intro', l.id), l.id);
    assert.equal(moodFor('play', l.id), l.id);
    assert.ok(SONGS[l.id], `${l.id} has a song written for it`);
    tunes.add(JSON.stringify(barNotes(songFor(l.id), 0).filter((n) => n.voice === 'lead').map((n) => n.midi)));
  }
  assert.ok(tunes.size >= LEVELS.length - 2, 'levels sound different from each other');
});

test('a level without a song still gets one, the same every time', () => {
  const a = songFor('some-new-level');
  assert.deepEqual(a, songFor('some-new-level'));
  assert.ok(a.bpm >= 90 && a.bpm <= 130);
  assert.ok(barNotes(a, 0).some((n) => n.voice === 'lead'));
});

test('every bar of every song stays in its key, in its bar and in a pleasant range', () => {
  for (const mood of [...Object.keys(SONGS), 'some-new-level']) {
    const song = songFor(mood);
    assert.ok(barSeconds(song) > 1.5 && barSeconds(song) < 3, mood);
    for (let bar = 0; bar < 16; bar++) {
      const notes = barNotes(song, bar);
      assert.deepEqual(notes, barNotes(song, bar), 'the same bar plays the same notes');
      assert.ok(notes.some((n) => n.voice === 'bass') && notes.some((n) => n.voice === 'chord'), `${mood} bar ${bar}`);
      for (const n of notes) {
        assert.ok(n.at >= 0 && n.at < 4 && n.len > 0 && n.at + n.len <= 4.5, `${mood} bar ${bar}: ${JSON.stringify(n)}`);
        if (['kick', 'hat', 'snare'].includes(n.voice)) continue;
        assert.ok(MAJOR.includes((((n.midi - song.root) % 12) + 12) % 12), `${mood} bar ${bar}: ${n.voice} ${n.midi} is out of key`);
        const [lo, hi] = n.voice === 'bass' ? [28, 64] : n.voice === 'chord' ? [40, 80] : [55, 96];
        assert.ok(n.midi >= lo && n.midi <= hi, `${mood} ${n.voice} ${n.midi} out of range`);
        assert.ok(Number.isFinite(hz(n.midi)));
      }
    }
  }
});

test('the tune repeats: an 8-bar phrase comes round again', () => {
  const song = songFor('menu');
  assert.deepEqual(barNotes(song, 0), barNotes(song, 8));
  assert.notDeepEqual(barNotes(song, 0), barNotes(song, 1));
});

test('voices win: the music goes down at once, stays down between words, then comes back slowly', () => {
  assert.equal(duckGain(0), DUCK);
  assert.equal(duckGain(HOLD), DUCK);
  assert.ok(duckGain(HOLD + RELEASE) > 0.999);
  assert.equal(duckGain(HOLD + RELEASE + 0.01), 1);
  assert.equal(duckGain(Infinity), 1);
  let prev = 0;
  for (let t = 0; t < HOLD + RELEASE + 1; t += 0.05) {
    assert.ok(duckGain(t) >= prev, 'never dips again on the way up');
    prev = duckGain(t);
  }
  // On a call, while someone talks, the music is about 15 dB quieter than it is when playing alone at home
  assert.ok(20 * Math.log10(FAMILY * DUCK) <= -14, 'ducked enough under voices');
  assert.ok(LEVEL <= 0.7, 'never loud');
});

test('loudness of a stretch of samples', () => {
  assert.equal(rms([]), 0);
  assert.equal(rms([0.5, -0.5, 0.5, -0.5]), 0.5);
});

test('music on by default, ?music=off, and the grown-up turning it off is remembered', () => {
  const store = new Map();
  const storage = /** @type {any} */ ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
  const none = new URLSearchParams('');
  assert.equal(musicOn(none, storage), true);
  saveMusicOn(storage, false);
  assert.equal(musicOn(none, storage), false);
  assert.equal(musicOn(new URLSearchParams('music=on'), storage), true);
  saveMusicOn(storage, true);
  assert.equal(musicOn(new URLSearchParams('music=off'), storage), false);
  const blocked = /** @type {any} */ ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(musicOn(none, blocked), true);
  saveMusicOn(blocked, false); // no throw
});
