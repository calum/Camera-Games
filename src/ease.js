// Auto-ease: when the kids keep failing, the game quietly slows down; after a good spell it creeps back up.
// Pure (no DOM), so the rules are unit-tested. main.js multiplies g.diff by `factor`, and levels whose
// difficulty is not a speed (hold times, gravity) read g.ease.
//
// A "miss" is a hit by a rock, a splash, a bonk or a dropped balloon. A long spell with no points at all
// (bubbles nobody can reach, a pose nobody can hold) eases it too.
// A "hit" is points for a kid. Team-only points (a rock falling past) are not hits, since they come whether
// or not anyone is doing well, but they do stop the no-points clock: dodging well earns only team points.

export const EASE = {
  window: 12, // s: misses and hits are counted over this long
  misses: 3, // this many misses in the window (and more misses than hits) eases the game one step
  step: 0.15, // how much one step slows things
  min: 0.55, // never slower than this
  recover: 20, // s without a step down before it speeds up again...
  up: 0.05, // ...by this much
  drought: 15, // s with no points while playing eases one step
};

export class Ease {
  constructor(opts = {}) {
    this.o = { ...EASE, ...opts };
    this.reset();
  }

  // A new game: back to normal speed.
  reset() {
    this.factor = 1;
    /** @type {number[]} */
    this.misses = [];
    /** @type {number[]} */
    this.hits = [];
    this.lastChange = -Infinity; // time of the last step down or up
    this.lastPoint = null; // time of the last hit, for the drought rule (null = not started)
  }

  /** @param {number} now */
  miss(now) {
    this.misses.push(now);
    this.prune(now);
    if (this.misses.length >= this.o.misses && this.misses.length > this.hits.length) {
      this.stepDown(now);
      this.misses = [];
      this.hits = [];
    }
  }

  /** @param {number} now */
  hit(now) {
    this.hits.push(now);
    this.point(now);
    this.prune(now);
  }

  // Team points: not a hit, but not a dry spell either.
  /** @param {number} now */
  point(now) {
    this.lastPoint = now;
  }

  // The team ran out of hearts: the replay is a step easier.
  /** @param {number} now */
  failedLevel(now) {
    this.stepDown(now);
    this.misses = [];
    this.hits = [];
  }

  // Call every frame while a level is being played. `playing` = there is at least one active kid.
  /** @param {number} now @param {boolean} playing */
  update(now, playing) {
    if (!playing || this.lastPoint === null) {
      this.lastPoint = now; // nobody there (or a new level): don't count the gap as a drought
    } else if (now - this.lastPoint >= this.o.drought) {
      this.lastPoint = now;
      this.stepDown(now);
    }
    if (this.factor < 1 && now - this.lastChange >= this.o.recover) {
      this.factor = Math.min(1, this.factor + this.o.up);
      this.lastChange = now;
    }
  }

  // A level starts (or replays): the drought clock starts fresh, the eased speed is kept.
  newLevel() {
    this.lastPoint = null;
    this.misses = [];
    this.hits = [];
  }

  /** @param {number} now */
  stepDown(now) {
    this.factor = Math.max(this.o.min, this.factor - this.o.step);
    this.lastChange = now;
  }

  /** @param {number} now */
  prune(now) {
    const since = now - this.o.window;
    this.misses = this.misses.filter((t) => t > since);
    this.hits = this.hits.filter((t) => t > since);
  }
}
