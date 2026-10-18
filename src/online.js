// Family play, the pure part (no camera, no DOM, no network): what a guest sends, how the host turns it back
// into players, and the arithmetic for the cut-out video frame. The WebRTC plumbing lives in family.js.
//
// The guest's home runs its own tracking and cut-out. It sends the host (1) its skeletons, small and exact,
// and (2) its cut-out as video. The host treats the skeletons as ordinary players, so levels, scoring and
// the lobby need no changes. See docs/ONLINE.md.
/** @import { Player, Point } from './types.js' */
import { COLORS } from './people.js';
import { computeFeatures } from './tracker.js';

// Letters only, no vowels (no accidental words), no look-alikes: easy to read out over the phone.
const ALPHABET = 'BCDFGHJKLMNPRSTVWXZ';
export const CODE_LENGTH = 4;

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

/** Remote players get ids from here up, so they can never collide with the host's own. */
export const REMOTE_ID_BASE = 1000;

const r4 = (/** @type {number} */ n) => Math.round(n * 10000) / 10000;

/**
 * The guest's players as a small message. Positions are fractions of the guest's screen, so the host can
 * place them on any screen size.
 * @param {Player[]} players  the guest's visible players, in screen pixels
 * @param {number} W @param {number} H  the guest's canvas size
 * @param {number} seq  counts up, so the host can drop a late message that overtook a newer one
 */
export function packPlayers(players, W, H, seq) {
  return {
    n: seq,
    ps: players.map((p) => ({
      i: p.id,
      l: p.look ? p.look.map(r4) : null,
      p: p.px.flatMap((q) => [r4(q.x / W), r4(q.y / H)]),
    })),
  };
}

/** Inverse of the positions in packPlayers. @returns {Point[]} */
export function unpackPoints(/** @type {number[]} */ flat, W, H) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i] * W, y: flat[i + 1] * H });
  return out;
}

/**
 * The guests, as the host's players. Same shape as the kids the camera finds, with `remote: true`.
 * Nothing pops: like local kids they stay present through a short dropout and are remembered a while.
 */
export class RemoteCrowd {
  constructor({ dropout = 0.6, forget = 20 } = {}) {
    this.o = { dropout, forget };
    /** @type {(Player & { remote?: boolean })[]} */
    this.players = [];
    this.lastSeq = -1;
  }

  reset() {
    this.players = [];
    this.lastSeq = -1;
  }

  /**
   * @param {{ n: number, ps: { i: number, l: number[] | null, p: number[] }[] }} msg  from packPlayers
   * @param {number} now  host game time
   * @param {number} W @param {number} H  the host's canvas size
   * @param {number[]} usedSlots  colour slots the host's own kids use, so guests get different colours
   */
  ingest(msg, now, W, H, usedSlots = []) {
    if (msg.n <= this.lastSeq) return; // a late arrival that overtook a newer message (reset() when a guest reconnects)
    this.lastSeq = msg.n;
    for (const r of msg.ps) {
      if (!r || r.p?.length !== 66) continue; // not a 33-landmark skeleton
      const id = REMOTE_ID_BASE + r.i;
      let p = this.players.find((q) => q.id === id);
      if (!p) {
        const taken = new Set([...usedSlots, ...this.players.map((q) => q.slot)]);
        let slot = 0;
        while (taken.has(slot)) slot++;
        p = {
          id, slot, color: COLORS[slot % COLORS.length], remote: true,
          // @ts-ignore filled in just below
          px: null,
          present: true, isNew: true, seen: now, score: 0, jumps: 0, lastJump: -99, hitUntil: 0,
          pose: {}, hands: [], circles: [], sh: { x: 0, y: 0 }, hip: { x: 0, y: 0 }, cx: 0, shoulderW: 0, torso: 0,
        };
        this.players.push(p);
      }
      p.px = unpackPoints(r.p, W, H);
      p.look = r.l;
      p.seen = now;
      p.present = true;
      computeFeatures(p, now);
    }
  }

  /** Age everyone. @returns {Player[]} the guests the game should see */
  tick(/** @type {number} */ now) {
    this.players = this.players.filter((p) => now - p.seen < this.o.forget);
    for (const p of this.players) p.present = now - p.seen < this.o.dropout;
    return this.players.filter((p) => p.present);
  }
}

/**
 * Video has no transparency, so a cut-out travels as a double-wide frame: the left half is the colour
 * picture over black, the right half is how opaque each pixel is, as grey. This rebuilds the RGBA picture.
 * @param {Uint8ClampedArray} src  RGBA of the double-wide frame, 2w x h
 * @param {number} w  width of ONE half
 * @param {number} h
 * @param {Uint8ClampedArray} dst  RGBA, w x h
 */
export function decodeDoubleWide(src, w, h, dst) {
  const stride = w * 2 * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * stride + x * 4;
      const a = src[s + w * 4]; // red channel of the right half
      const d = (y * w + x) * 4;
      if (a < 4) {
        dst[d] = dst[d + 1] = dst[d + 2] = dst[d + 3] = 0;
        continue;
      }
      // the colour half is colour * alpha over black: undo that, or the edges would come out dark
      const k = 255 / a;
      dst[d] = src[s] * k;
      dst[d + 1] = src[s + 1] * k;
      dst[d + 2] = src[s + 2] * k;
      dst[d + 3] = a;
    }
  }
}
