// Browser side of debug recordings (recording.js has the format): saving the last minute as a file, and the
// optional video of the game screen. Only created in debug mode, so a normal game pays nothing for it.
// Everything stays on this computer: saving is an ordinary download, and nothing is ever uploaded.
// The video shows the kids, so it is never on by itself: a grown-up turns it on (key G or the Video button).
import { Recorder, recordingName } from './recording.js';

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
