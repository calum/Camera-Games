// Room codes, shared by the game and the Cloudflare pairing function (cloudflare/worker.js), so both agree on
// what a code looks like. No imports: it has to run in a Worker as well as in the browser and in the tests.

// Letters only, no vowels (no accidental words), no look-alikes: easy to read out over the phone.
export const ALPHABET = 'BCDFGHJKLMNPRSTVWXZ';
// 19^5 = 2.5 million codes. Four letters would be easier to say but a stranger could guess a live room too easily.
export const CODE_LENGTH = 5;

/** @param {() => number} [rand] */
export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

/** Tidy what a person typed or a link carried; null when it cannot be a code. @param {string | null | undefined} s */
export function normaliseCode(s) {
  const t = String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return t.length === CODE_LENGTH && [...t].every((c) => ALPHABET.includes(c)) ? t : null;
}
