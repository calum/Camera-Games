// Background music, made up by the game itself (no files, nothing to license). Pure: what notes a song plays
// and how loud the music should be. audio.js turns the notes into sound.
//
// A song is a short loop: a 4-chord progression, a bass, soft chord arpeggios, a little tune and gentle drums.
// The tune comes from a seeded random walk over the pentatonic scale, so it is the same every time a level is
// played (kids learn it) and every level sounds like its own place. 8 bars make a phrase: the opening motif
// comes back, so it sounds like a song rather than noodling.

import { rng } from './scene-kit.js'; // seeded, so a song is the same every time

// How loud the music is (multiplies every note). The notes themselves sit about 10 dB under the sound effects,
// so a pop or a bonk is always heard over the music.
export const LEVEL = 0.6;
// During family play the other home's voices come first: the music plays quieter all the time...
export const FAMILY = 0.6;
// ...and drops a long way further while anyone on the call is talking (or laughing).
export const DUCK = 0.3;
export const VOICE_RMS = 0.015; // loudness (RMS, 0-1) that counts as someone talking; noise suppression is on
export const HOLD = 0.6; // seconds the music stays down after the last word, so it doesn't pump between words
export const RELEASE = 1.2; // seconds it then takes to come back up

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];

/**
 * @typedef {object} Song
 * @property {string} name
 * @property {number} bpm
 * @property {number} root    MIDI note of the key (60 = middle C)
 * @property {number[]} chords  scale degrees (0 = I, 3 = IV, 4 = V, 5 = vi), one per bar, looped
 * @property {'bounce'|'calm'|'drive'|'float'} style
 * @property {OscillatorType} lead
 * @property {number} seed
 */
/**
 * @typedef {object} MusicNote
 * @property {number} at    beats from the start of the bar
 * @property {number} len   beats
 * @property {number} midi
 * @property {'bass'|'chord'|'lead'|'kick'|'hat'|'snare'} voice
 */

/** @type {Record<string, Song>} */
export const SONGS = {
  menu: { name: 'Hello everyone', bpm: 96, root: 60, chords: [0, 5, 3, 4], style: 'calm', lead: 'triangle', seed: 7 },
  bubbles: { name: 'Bubble float', bpm: 100, root: 65, chords: [0, 3, 0, 4], style: 'float', lead: 'sine', seed: 11 },
  dodge: { name: 'Dodge it', bpm: 118, root: 67, chords: [0, 4, 5, 3], style: 'drive', lead: 'square', seed: 23 },
  jump: { name: 'Boing boing', bpm: 124, root: 62, chords: [0, 3, 4, 3], style: 'bounce', lead: 'square', seed: 5 },
  dig: { name: 'Down the mine', bpm: 104, root: 57, chords: [5, 3, 0, 4], style: 'bounce', lead: 'triangle', seed: 31 },
  duckjump: { name: 'Duck and jump', bpm: 120, root: 64, chords: [0, 5, 3, 4], style: 'drive', lead: 'triangle', seed: 17 },
  meteor: { name: 'Space stars', bpm: 108, root: 58, chords: [0, 3, 5, 4], style: 'float', lead: 'sine', seed: 41 },
  avalanche: { name: 'Snowy hill', bpm: 116, root: 60, chords: [0, 4, 3, 4], style: 'drive', lead: 'triangle', seed: 13 },
  balloons: { name: 'Up and away', bpm: 100, root: 65, chords: [0, 5, 3, 4], style: 'bounce', lead: 'sine', seed: 29 },
  wall: { name: 'Squeeze through', bpm: 112, root: 67, chords: [0, 3, 4, 0], style: 'drive', lead: 'square', seed: 3 },
  dance: { name: 'Disco', bpm: 110, root: 57, chords: [5, 3, 0, 4], style: 'drive', lead: 'triangle', seed: 19 },
  snowball: { name: 'Snowball silly', bpm: 132, root: 65, chords: [0, 4, 5, 4], style: 'bounce', lead: 'square', seed: 37 },
  fly: { name: 'Up in the clouds', bpm: 104, root: 62, chords: [0, 5, 3, 4], style: 'float', lead: 'sine', seed: 43 },
};
// Freeze! plays its own little tune and the kids freeze when it stops, so other music there would spoil it.
export const SILENT_LEVELS = new Set(['freeze']);

/** A level nobody wrote a song for still gets its own one, made from its id. @param {string} id @returns {Song} */
function songFromId(id) {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const styles = /** @type {const} */ (['bounce', 'drive', 'float', 'bounce']);
  const progs = [[0, 5, 3, 4], [0, 3, 4, 3], [0, 4, 5, 3], [5, 3, 0, 4]];
  return { name: id, bpm: 104 + (h % 5) * 4, root: 57 + (h % 11), chords: progs[(h >> 4) % 4], style: styles[(h >> 8) % 4], lead: 'triangle', seed: h };
}

/**
 * What should be playing. Null is silence.
 * @param {string} state  the game state (main.js)
 * @param {string | null | undefined} levelId
 * @returns {string | null}
 */
export function moodFor(state, levelId) {
  if (state === 'menu' || state === 'calibrate' || state === 'pick') return 'menu'; // one tune from joining to choosing
  if ((state === 'intro' || state === 'play') && levelId) return SILENT_LEVELS.has(levelId) ? null : levelId;
  return null; // loading, the setup check, and the end of a level (its fanfare or wah-wah plays alone)
}

/** @param {string} mood @returns {Song} */
export const songFor = (mood) => SONGS[mood] ?? songFromId(mood);

/** Seconds per bar (4 beats). @param {Song} song */
export const barSeconds = (song) => (4 * 60) / song.bpm;

/** The notes of a chord on scale degree `deg`, as semitones above the key. @param {number} deg */
function chordTones(deg) {
  const at = (i) => MAJOR[i % 7] + 12 * Math.floor(i / 7);
  return [at(deg), at(deg + 2), at(deg + 4)];
}

// A motif is 8 eighth-note slots: a pentatonic step (or null for a rest). Made once per song and seed.
const motifs = new Map();
function motif(song, which) {
  const key = `${song.seed}:${which}`;
  if (!motifs.has(key)) {
    const r = rng(song.seed * 7 + which);
    let step = 5 + Math.floor(r() * 3); // the middle of a two-octave pentatonic range
    const slots = [];
    for (let i = 0; i < 8; i++) {
      const strong = i % 2 === 0;
      if (!strong && r() < 0.45) slots.push(null);
      else {
        step = Math.max(2, Math.min(10, step + Math.floor(r() * 5) - 2));
        slots.push(step);
      }
    }
    slots[0] ??= step; // a motif always starts on a note
    motifs.set(key, slots);
  }
  return motifs.get(key);
}
// Which motif each bar of the 8-bar phrase uses; bar 7 is the ending.
const PHRASE = [0, 1, 0, 2, 0, 1, 3, -1];

/** Semitones of pentatonic step `s` (0 = the key, 5 = an octave up). */
const penta = (s) => PENTA[s % 5] + 12 * Math.floor(s / 5);

/**
 * The notes of one bar.
 * @param {Song} song
 * @param {number} bar  counts up from 0 while the song plays
 * @returns {MusicNote[]}
 */
export function barNotes(song, bar) {
  /** @type {MusicNote[]} */
  const out = [];
  const deg = song.chords[bar % song.chords.length];
  const chord = chordTones(deg);
  const root = song.root;
  const bassNote = root - 24 + (chord[0] % 12);

  // bass
  if (song.style === 'calm' || song.style === 'float') {
    out.push({ at: 0, len: 1.8, midi: bassNote, voice: 'bass' }, { at: 2, len: 1.8, midi: bassNote + (bar % 2 ? 7 : 0), voice: 'bass' });
  } else {
    for (let b = 0; b < 4; b++) out.push({ at: b, len: 0.8, midi: bassNote + (song.style === 'bounce' && b % 2 ? 12 : 0), voice: 'bass' });
  }

  // soft chord arpeggio, up and down on eighths
  const arp = [0, 1, 2, 1, 0, 1, 2, 1];
  const every = song.style === 'float' ? 1 : 0.5;
  for (let i = 0; i * every < 4; i++) out.push({ at: i * every, len: every * 0.9, midi: root - 12 + chord[arp[i % 8]], voice: 'chord' });

  // the tune
  const which = PHRASE[bar % PHRASE.length];
  if (which < 0) {
    out.push({ at: 0, len: 2.5, midi: root + 12 * (chord[0] >= 7 ? 0 : 1) + (chord[0] % 12), voice: 'lead' }); // land on the chord's root
  } else {
    motif(song, which).forEach((s, i) => {
      if (s == null) return;
      let midi = root + penta(s);
      // on the beat, snap to the chord so the tune fits the harmony
      if (i % 2 === 0) midi = nearestChordNote(midi, root, chord);
      out.push({ at: i / 2, len: 0.45, midi, voice: 'lead' });
    });
  }

  // drums: soft, a kids' party, not a club
  if (song.style !== 'float' || bar % 2 === 1) for (const b of song.style === 'calm' ? [0, 2] : [0, 1, 2, 3]) out.push({ at: b, len: 0.2, midi: 0, voice: 'kick' });
  if (song.style !== 'calm') for (let b = 0; b < 4; b++) out.push({ at: b + 0.5, len: 0.1, midi: 0, voice: 'hat' });
  if (song.style === 'drive' || song.style === 'bounce') out.push({ at: 1, len: 0.2, midi: 0, voice: 'snare' }, { at: 3, len: 0.2, midi: 0, voice: 'snare' });
  return out;
}

function nearestChordNote(midi, root, chord) {
  let best = midi;
  let bestD = Infinity;
  for (let o = -1; o <= 2; o++)
    for (const c of chord) {
      const n = root + c + 12 * o;
      const d = Math.abs(n - midi);
      if (d < bestD) [best, bestD] = [n, d];
    }
  return best;
}

/** @param {number} midi */
export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Loudness (RMS) of a stretch of samples. @param {ArrayLike<number>} samples */
export function rms(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return samples.length ? Math.sqrt(s / samples.length) : 0;
}

/**
 * How far down the music goes for voices: 1 = not at all, DUCK = all the way. Down at once when someone talks,
 * held for HOLD seconds after the last word, then back up over RELEASE seconds.
 * @param {number} sinceVoice  seconds since someone was last heard (Infinity: nobody yet)
 */
export function duckGain(sinceVoice) {
  if (sinceVoice <= HOLD) return DUCK;
  const k = (sinceVoice - HOLD) / RELEASE;
  if (k >= 1) return 1;
  return DUCK + (1 - DUCK) * k;
}

/** Is music on? Off with ?music=off or after the grown-up turned it off (remembered). */
const MUSIC_KEY = 'kcg.music';
export function musicOn(/** @type {URLSearchParams} */ params, /** @type {Storage | undefined} */ storage) {
  if (params.has('music')) return params.get('music') !== 'off';
  try {
    return storage?.getItem(MUSIC_KEY) !== 'off';
  } catch {
    return true; // storage blocked (private mode etc.)
  }
}
export function saveMusicOn(/** @type {Storage | undefined} */ storage, /** @type {boolean} */ on) {
  try {
    storage?.setItem(MUSIC_KEY, on ? 'on' : 'off');
  } catch {
    /* not worth failing over */
  }
}
