// Browser glue for the cut-out: grabs a small grayscale copy of the camera for the motion check, runs
// the PersonMask logic, and produces a canvas holding only the people (transparent elsewhere).
import { PersonMask } from './person-mask.js';

export class Cutout {
  constructor() {
    this.pm = null;
    this.grab = document.createElement('canvas'); // tiny copy of the camera, read back as gray
    this.gctx = this.grab.getContext('2d', { willReadFrequently: true });
    this.alphaCanvas = document.createElement('canvas'); // the mask as an alpha channel, same tiny size
    this.actx = this.alphaCanvas.getContext('2d');
    this.out = document.createElement('canvas'); // camera frame with everything but people removed
    this.octx = this.out.getContext('2d');
    this.gray = null;
    this.alphaImage = null;
  }

  get stats() {
    return this.pm?.stats ?? { coverage: 0, motionFrac: 0, poseActive: false, globalChange: false };
  }

  // maskLow: the pose model's merged silhouettes (mw x mh floats) or null. Returns true when
  // `this.out` holds a fresh cut-out to draw.
  update(video, maskLow, mw, mh, dt) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !maskLow) return false;

    if (!this.pm || this.pm.w !== mw || this.pm.h !== mh) {
      this.pm = new PersonMask(mw, mh);
      this.grab.width = this.alphaCanvas.width = mw;
      this.grab.height = this.alphaCanvas.height = mh;
      this.gray = new Uint8Array(mw * mh);
      this.alphaImage = this.actx.createImageData(mw, mh);
    }
    if (this.out.width !== vw || this.out.height !== vh) {
      this.out.width = vw;
      this.out.height = vh;
    }

    this.gctx.drawImage(video, 0, 0, mw, mh);
    const px = this.gctx.getImageData(0, 0, mw, mh).data;
    const gray = this.gray;
    for (let i = 0, n = mw * mh; i < n; i++) gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;

    const alpha = this.pm.update(gray, maskLow, dt);
    const d = this.alphaImage.data;
    for (let i = 0, n = mw * mh; i < n; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
      d[i * 4 + 3] = alpha[i];
    }
    this.actx.putImageData(this.alphaImage, 0, 0);

    // camera frame, keeping only where the mask is opaque (bilinear upscale = soft edges)
    const o = this.octx;
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, vw, vh);
    o.drawImage(video, 0, 0, vw, vh);
    o.globalCompositeOperation = 'destination-in';
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    o.drawImage(this.alphaCanvas, 0, 0, vw, vh);
    o.globalCompositeOperation = 'source-over';
    return true;
  }

  // Draw mirrored (like a mirror) into the rectangle where the camera picture sits on screen.
  draw(ctx, rect) {
    ctx.save();
    ctx.translate(rect.x + rect.w, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(this.out, 0, 0, rect.w, rect.h);
    ctx.restore();
  }
}
