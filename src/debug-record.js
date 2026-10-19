// Browser side of debug recordings (recording.js has the format): saving the last minute as a file, and the
// optional video of the game screen. Only created in debug mode, so a normal game pays nothing for it.
// Everything stays on this computer: saving is an ordinary download, and nothing is ever uploaded.
// The video shows the kids, so it is never on by itself: a grown-up turns it on (key G or the Video button).
/** @import { Game } from './types.js' */
/** @import { Recording } from './recording.js' */
/** @import { ReplayTracker } from './replay.js' */
import { Recorder, recordingName, parseRecording } from './recording.js';
import { text } from './draw.js';

const SEGMENT_S = 30; // the video is kept as two 30 s pieces, so the last 30-60 s can always be saved

// The game screen as video, in pieces of SEGMENT_S: a WebM file can't have its start cut off, so a rolling
// minute is the last finished piece plus the one being recorded.
class VideoClip {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.stream = canvas.captureStream(30);
    this.type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    /** @type {Blob | null} */ this.prev = null;
    /** @type {MediaRecorder | null} */ this.rec = null;
    this.timer = 0;
    this._next();
  }

  _next() {
    const rec = new MediaRecorder(this.stream, { mimeType: this.type, videoBitsPerSecond: 2_500_000 });
    /** @type {Blob[]} */
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => (this.prev = new Blob(chunks, { type: 'video/webm' }));
    rec.start(1000);
    this.rec = rec;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._roll(), SEGMENT_S * 1000);
  }

  _roll() {
    this.rec?.stop();
    this._next();
  }

  // The pieces covering the last 30-60 s (the one being recorded is finished off and a new one started)
  /** @returns {Promise<Blob[]>} */
  async take() {
    const older = this.prev;
    const rec = this.rec;
    const done = new Promise((r) => rec.addEventListener('stop', r, { once: true }));
    rec.stop();
    await done;
    const latest = this.prev;
    this._next();
    return [older, latest].filter((b) => b && b.size);
  }

  stop() {
    clearTimeout(this.timer);
    this.rec?.stop();
    this.rec = null;
    for (const t of this.stream.getTracks()) t.stop();
  }
}

export class DebugRecorder {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.data = new Recorder();
    /** @type {VideoClip | null} */ this.video = null;
    this.saving = false;
  }

  get videoOn() {
    return !!this.video;
  }

  // Turn the screen video on or off. Says whether it is on now.
  toggleVideo() {
    if (this.video) {
      this.video.stop();
      this.video = null;
    } else if (typeof MediaRecorder !== 'undefined' && this.canvas.captureStream) {
      this.video = new VideoClip(this.canvas);
    }
    return this.videoOn;
  }

  /**
   * Download the last minute: one .json (tracking, timings, events) and, if the video is on, one or two .webm
   * pieces. Resolves with the file names.
   * @param {Record<string, any>} meta
   */
  async save(meta) {
    if (this.saving) return [];
    this.saving = true;
    try {
      const name = recordingName(new Date());
      const names = [`${name}.json`];
      download(new Blob([JSON.stringify(this.data.toFile(meta))], { type: 'application/json' }), names[0]);
      if (this.video) {
        const pieces = await this.video.take();
        pieces.forEach((b, i) => {
          const n = `${name}-video${pieces.length > 1 ? `-${i + 1}` : ''}.webm`;
          names.push(n);
          download(b, n);
        });
      }
      return names;
    } finally {
      this.saving = false;
    }
  }
}

/** @param {Blob} blob  @param {string} name */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/**
 * How the game looks right now, for a sample or a saved file. main.js builds it fresh each time it is asked.
 * @typedef {object} DebugView
 * @property {string} state
 * @property {number} levelT
 * @property {number} fps
 * @property {any} tracker      the tracker in use (camera, mouse or replay)
 * @property {any} pose         the camera tracker (PoseTracker), or null
 * @property {boolean} camera   the camera tracker is the one in use
 * @property {string | null} reconnecting
 * @property {number | null} cutout  percent of the screen the cut-out covers, null when it is off
 * @property {string} gpu
 * @property {string[]} lines   the debug panel's lines
 * @property {boolean} replaying
 */

/**
 * What the debug glue needs from the game.
 * @typedef {object} DebugHost
 * @property {HTMLCanvasElement} canvas
 * @property {Game & Record<string, any>} g
 * @property {() => DebugView} view
 * @property {(text: string, secs?: number) => void} toast
 * @property {(recording: Recording) => void} play  load a recording and play it through the game
 */

const round1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

// The game's side of debug recordings. While debug is on, the last minute is kept: every tracking answer, a few
// samples a second of how things ran, and what happened. R saves it as a file to send back with a problem; G adds
// a video of the screen (it shows the kids, so only when asked). ?replay (or dropping a file on the page, or L)
// plays one back through the real game. Nothing here runs, or costs anything, until debug is turned on.
export class DebugSession {
  /** @param {DebugHost} host */
  constructor(host) {
    this.host = host;
    /** @type {DebugRecorder | null} */
    this.rec = null;
    this.sampleAt = 0;
    this.replayEnded = false; // the "Replay finished" toast was shown
    window.addEventListener('dragover', (e) => (host.g.debug || host.view().replaying) && e.preventDefault());
    window.addEventListener('drop', (e) => {
      if (!(host.g.debug || host.view().replaying)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) this.open(file);
    });
  }

  // The recorder, made the first time it is needed.
  recorder() {
    if (this.rec) return this.rec;
    this.rec = new DebugRecorder(this.host.canvas);
    // warnings (recovery, slow drawing) go in the recording too
    for (const level of /** @type {const} */ (['warn', 'error'])) {
      const orig = console[level];
      console[level] = (...a) => {
        this.note(level, { text: a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ') });
        orig.apply(console, a);
      };
    }
    this.note('state', { state: this.host.view().state, level: this.host.g.level?.id ?? null });
    return this.rec;
  }

  /** Something happened (a score, a state change, a toast...). @param {string} type  @param {Record<string, any>} [data] */
  note = (type, data) => {
    const g = this.host.g;
    if (g.debug && this.rec) this.rec.data.event(g.now, type, data);
  };

  // Every frame while debug is on: tracking answers as they arrive, and how things ran 4 times a second.
  /** @param {number} now */
  sample(now) {
    const rec = this.recorder();
    const g = this.host.g;
    const v = this.host.view();
    const pose = v.pose;
    if (pose && !pose.onAnswer) pose.onAnswer = (res, t) => g.debug && rec.data.frame(t, res.landmarks, res.looks, pose.video.videoWidth, pose.video.videoHeight);
    if (now < this.sampleAt) return;
    this.sampleAt = now + 0.25;
    const cam = v.camera;
    rec.data.sample(now, {
      state: v.state,
      level: g.level?.id ?? null,
      levelT: round1(v.levelT),
      fps: v.fps,
      detectMs: round1(v.tracker?.detectMs ?? 0),
      modelMs: cam ? round1(pose.modelMs) : null,
      quality: cam ? pose.quality.name : null,
      tracking: `${v.tracker?.delegate}${cam ? (pose.useWorker ? ' worker' : ' main') : ''}`,
      cameraFps: cam ? round1(pose.cameraFps) : null,
      reconnecting: v.reconnecting,
      diff: Math.round(g.diff * 100) / 100,
      score: g.team.score,
      hearts: g.team.hearts,
      view: g.view,
      fx: g.fx,
      cutout: v.cutout,
      players: g.players.map((p) => ({ id: p.id, x: Math.round(p.cx), out: !!p.excluded, pose: Object.keys(p.pose ?? {}).filter((k) => p.pose[k]).join('+') })),
    });
  }

  // R: download the last minute (and the screen video, if it is on).
  async save() {
    const g = this.host.g;
    if (!g.debug) return;
    const r = this.recorder();
    const secs = Math.round(r.data.span);
    const v = this.host.view();
    try {
      const names = await r.save({
        saved: new Date().toISOString(),
        browser: navigator.userAgent,
        gpu: v.gpu,
        screen: [g.W, g.H],
        url: location.search,
        state: v.state,
        level: g.level?.id ?? null,
        camera: v.pose ? { label: v.pose.cameraLabel, size: [v.pose.video.videoWidth, v.pose.video.videoHeight], mode: v.pose.mode } : null,
        debug: v.lines,
      });
      if (names.length) this.host.toast(`Saved the last ${secs} s: ${names.join(', ')} (in Downloads)`, 6);
    } catch (e) {
      console.warn('could not save the recording', e);
      this.host.toast(`Could not save: ${e.message || e}`, 5);
    }
  }

  // The debug panel's line about the recording.
  get line() {
    const rec = this.rec;
    if (!rec) return 'recording: starting';
    return `recording the last ${Math.round(rec.data.span)} s${rec.videoOn ? ' + screen video' : ''}   R save   G video ${rec.videoOn ? 'off' : 'on'}   L load a recording`;
  }

  // L: pick a recording file to play.
  choose() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => input.files[0] && this.open(input.files[0]);
    input.click();
  }

  /** @param {File} file */
  async open(file) {
    try {
      this.host.play(parseRecording(await file.text()));
    } catch (e) {
      this.host.toast(e.message || String(e), 5);
    }
  }

  // How far the replay has got, bottom left, and a note when it has finished.
  /** @param {CanvasRenderingContext2D} ctx  @param {ReplayTracker} replay */
  drawReplay(ctx, replay) {
    const g = this.host.g;
    const u = g.u;
    if (replay.done && replay.rec.frames.length && !this.replayEnded) {
      this.replayEnded = true;
      this.host.toast('Replay finished. Press L to load another', 5);
    }
    const what = replay.rec.frames.length ? `Replay ${Math.round(replay.progress * 100)}%` : 'Replay: no recording loaded';
    text(ctx, what, 30 * u, g.H - 70 * u, 30 * u, { align: 'left', color: '#ffe14d' });
  }
}
