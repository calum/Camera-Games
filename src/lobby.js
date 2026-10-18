// Join-by-arms-out lobby.
//
// Kids join by holding their arms out (the "airplane" pose). Once at least one kid is
// holding it and the group of airplane-kids hasn't changed for `hold` seconds, the game
// starts with exactly those kids. Anyone standing there without their arms out sits this
// one out. If someone joins or leaves, everyone gets a fresh countdown.
export class Lobby {
  constructor({ hold = 3, grace = 0.4 } = {}) {
    this.hold = hold; // seconds the group must stay the same
    this.grace = grace; // tracking flicker allowed before an arm-out kid counts as "dropped"
    this.reset();
  }

  reset() {
    this.seen = new Map(); // player id -> last time they had their arms out
    this.key = '';
    this.t = 0;
    this.joined = [];
  }

  // players: the people currently visible ({id, pose:{airplane}}). Returns the ids that are
  // playing once the countdown completes, otherwise null.
  update(players, now, dt) {
    for (const p of players) if (p.pose?.airplane) this.seen.set(p.id, now);
    this.joined = players
      .filter((p) => now - (this.seen.get(p.id) ?? -Infinity) < this.grace)
      .map((p) => p.id)
      .sort((a, b) => a - b);
    const key = this.joined.join(',');
    if (this.joined.length && key === this.key) this.t += dt;
    else {
      this.t = 0;
      this.key = key;
    }
    return this.t >= this.hold ? [...this.joined] : null;
  }

  get progress() {
    return Math.min(1, this.t / this.hold);
  }

  get secondsLeft() {
    return Math.max(1, Math.ceil(this.hold - this.t));
  }

  isJoined(id) {
    return this.joined.includes(id);
  }
}
