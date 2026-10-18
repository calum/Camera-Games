// Self-healing: notices when the picture or the tracking has stopped, so the game can put it right by itself
// instead of freezing. Pure (no camera, no DOM): PoseTracker feeds it what it sees every drawn frame.
//
//  - The camera is "lost" when its track has ended (unplugged, taken by another app, a phone that put it to
//    sleep) or the picture has not moved on for a few seconds.
//  - Tracking has "stalled" when a frame was sent off and no answer came back for much longer than tracking
//    normally takes (a crashed or hung worker never answers at all).
//  - A gap between checks (the tab was in the background, the laptop slept) restarts both clocks, so coming
//    back is never mistaken for a frozen camera.

export const HEALTH = {
  cameraStallS: 3, // no new picture for this long: the camera has gone
  trackerStallS: 10, // no answer for this long (or stallRounds times the usual round trip, if longer)
  stallRounds: 8,
  firstStallS: 30, // a freshly started model's first answer can be slow (shaders compiling on a slow laptop)
  gapS: 1, // checks further apart than this: the page was asleep
};

export class Health {
  constructor(opts = {}) {
    this.o = { ...HEALTH, ...opts };
    this.reset(null);
  }

  /** @param {number | null} now */
  reset(now) {
    this.lastCheck = now;
    this.lastVideoTime = -1;
    this.videoSince = now;
    this.lastSent = -1;
    this.sentAt = now;
  }

  /**
   * @param {{ now: number, trackLive: boolean, videoTime: number, waiting: boolean, sent: number, detectMs: number, warm: boolean }} s
   *   now, seconds; trackLive: the camera track is still running; videoTime: video.currentTime;
   *   waiting: a frame is out for tracking; sent: how many frames have been sent so far; detectMs: the usual round trip;
   *   warm: the model has answered at least once since it was started
   * @returns {{ camera: 'ok' | 'lost', tracker: 'ok' | 'stalled', woke: boolean }}
   */
  check({ now, trackLive, videoTime, waiting, sent, detectMs, warm }) {
    const woke = this.lastCheck !== null && now - this.lastCheck > this.o.gapS;
    if (woke || this.lastCheck === null) this.reset(now);
    this.lastCheck = now;
    if (videoTime !== this.lastVideoTime) {
      this.lastVideoTime = videoTime;
      this.videoSince = now;
    }
    if (sent !== this.lastSent) {
      this.lastSent = sent;
      this.sentAt = now;
    }
    const frozen = now - this.videoSince > this.o.cameraStallS;
    const limit = Math.max(warm ? this.o.trackerStallS : this.o.firstStallS, (this.o.stallRounds * detectMs) / 1000);
    return {
      camera: !trackLive || frozen ? 'lost' : 'ok',
      tracker: waiting && now - this.sentAt > limit ? 'stalled' : 'ok',
      woke,
    };
  }
}

// Seconds to wait before reconnecting attempt `n` (0, 1, 2, ...): quick at first, then every few seconds, so an
// unplugged camera is picked up soon after it is plugged back in without hammering the browser meanwhile.
export const retryDelay = (n) => Math.min(5, 0.5 * 2 ** n);
