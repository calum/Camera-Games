// Family play: the WebRTC and screen glue around online.js. Two roles share one scene:
//
//   host   the home that runs the game (the TV). Turns the guest's skeletons into players, draws the guest's
//          cut-out into the scene, and sends its finished picture back.
//   guest  the other home. Runs its own tracking and cut-out as usual, sends skeletons + cut-out, and shows
//          the host's picture full screen.
//
// Signalling (the two browsers finding each other) goes through `Signal`. For now that is a BroadcastChannel,
// so two tabs of one browser can pair with no server; a cloud function replaces it later without touching the
// rest. Video and skeletons then go directly between the browsers. See docs/ONLINE.md.
import { RemoteCrowd, decodeDoubleWide, makeRoomCode, normaliseCode, packPlayers } from './online.js';

// Replace with a STUN/TURN list for real networks (two different homes). Empty is fine on one machine.
const ICE_SERVERS = [];
const FRAME_W = 640; // one half of the cut-out frame; the frame sent is twice as wide
const FRAME_H = 360;
const SEND_EVERY = 1 / 30; // seconds between skeleton messages

/** Pairing messages between two browsers that know the same room code. */
class Signal {
  constructor(/** @type {string} */ code, /** @type {(m: any) => void} */ onMessage) {
    this.ch = new BroadcastChannel(`kcg-room-${code}`);
    this.ch.onmessage = (e) => onMessage(e.data);
  }
  send(/** @type {any} */ m) {
    this.ch.postMessage(m);
  }
  close() {
    this.ch.close();
  }
}

export class Family {
  /** @param {{ canvas: HTMLCanvasElement, search: string, origin?: string }} o */
  constructor({ canvas, search, origin = '' }) {
    this.canvas = canvas;
    this.origin = origin;
    /** @type {'off' | 'host' | 'guest'} */
    this.role = 'off';
    this.code = '';
    this.state = 'idle'; // idle | waiting | connecting | connected
    this.rtt = 0; // round trip in ms, measured over the data channel
    this.crowd = new RemoteCrowd();
    this.video = document.createElement('video'); // the other home's picture
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.audio = new Audio(); // the other home's voices
    this.audio.autoplay = true;
    this.mic = null; // our microphone stream, when we have one
    this.micReady = Promise.resolve(null);
    this.muted = false;
    this.micFailed = false;
    // Browsers hold back sound until the page has been touched; the first key or tap lets the voices through.
    const unlock = () => this.audio.srcObject && this.audio.play().catch(() => {});
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    this.guestCut = document.createElement('canvas'); // host: the guest, cut out, ready to draw
    this.gx = this.guestCut.getContext('2d');
    this.sample = document.createElement('canvas'); // host: the double-wide frame, read back as pixels
    this.sx = this.sample.getContext('2d', { willReadFrequently: true });
    this.frame = document.createElement('canvas'); // guest: the double-wide frame, sent as video
    this.frame.width = FRAME_W * 2;
    this.frame.height = FRAME_H;
    this.fx = this.frame.getContext('2d');
    this.half = document.createElement('canvas'); // guest: the silhouette half, built on its own
    this.half.width = FRAME_W;
    this.half.height = FRAME_H;
    this.hx = this.half.getContext('2d');
    this.hasGuest = false; // host: guestCut holds a picture
    this.seq = 0;
    this.sentAt = 0;
    this.cutAt = -Infinity;
    this.blankAt = -Infinity;
    this.lastVideoT = -1;
    this.sig = null;
    this.pc = null;
    this.dc = null;
    this.pending = [];
    this.offeredAt = -Infinity;
    this._latest = null;
    this.helloTimer = 0;
    this.pingTimer = 0;
    const code = normaliseCode(new URLSearchParams(search).get('room'));
    if (code) this.join(code);
  }

  get active() {
    return this.role !== 'off';
  }

  /** The guest is connected and sees the host's picture instead of its own game. */
  get guestView() {
    return this.role === 'guest' && this.state === 'connected';
  }

  get link() {
    return `${this.origin}?room=${this.code}`;
  }

  /** Key O / button: the host opens a room; anyone in a room leaves it. */
  toggle() {
    if (this.role === 'off') this.host();
    else this.leave();
  }

  host(code = makeRoomCode()) {
    this.leave();
    this.role = 'host';
    this.code = code;
    this.state = 'waiting';
    this.crowd.reset();
    this.out = this.canvas.captureStream(30); // our finished picture, sent to the guest
    this._getMic();
    this.sig = new Signal(code, (m) => {
      if (m.from !== 'guest') return;
      // A guest keeps saying hello until it is paired; one that arrives while we are already negotiating is
      // the same guest, not a new one.
      if (m.kind === 'hello') {
        if (performance.now() - this.offeredAt > 8000) this._offer();
      } else this._hostSignal(m);
    });
    this.pingTimer = setInterval(() => this._send({ ping: performance.now() }), 1000);
  }

  join(code) {
    this.leave();
    this.role = 'guest';
    this.code = code;
    this.state = 'connecting';
    this.out = this.frame.captureStream(30); // our cut-out, sent to the host
    this._getMic();
    this.sig = new Signal(code, (m) => m.from === 'host' && this._onSignal(m));
    // The host may not be listening yet: keep saying hello until it answers.
    const hello = () => this.state !== 'connected' && this.sig?.send({ from: 'guest', kind: 'hello' });
    hello();
    this.helloTimer = setInterval(hello, 1000);
  }

  /** Talk to each other: the kids' laughs reach the grandparents and the other way round. */
  _getMic() {
    // The browser's own echo cancellation keeps the TV's speakers from coming back down the line.
    const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
    this.micReady = (navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia(constraints) : Promise.reject(new Error('no microphone support')))
      .then((stream) => {
        if (this.role === 'off') {
          stream.getTracks().forEach((t) => t.stop());
          return null;
        }
        this.mic = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
        return stream;
      })
      .catch(() => {
        this.micFailed = true; // no microphone, or not allowed: carry on with pictures only
        return null;
      });
  }

  /** Key V: stop sending our microphone (and start again). */
  toggleMute() {
    this.muted = !this.muted;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
  }

  leave() {
    clearInterval(this.helloTimer);
    clearInterval(this.pingTimer);
    this._closePc();
    this.sig?.close();
    this.sig = null;
    this.out?.getTracks().forEach((t) => t.stop());
    this.out = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.micFailed = false;
    this.role = 'off';
    this.state = 'idle';
    this.hasGuest = false;
    this.crowd.reset();
  }

  // ---------------------------------------------------------------- connection
  _closePc() {
    this.dc?.close();
    this.pc?.close();
    this.dc = this.pc = null;
    this.pending = [];
    this.video.srcObject = null;
    this.audio.srcObject = null;
    this.hasGuest = false;
  }

  _addOutgoing(/** @type {RTCPeerConnection} */ pc) {
    for (const t of this.out.getTracks()) pc.addTrack(t, this.out);
    if (this.mic) for (const t of this.mic.getAudioTracks()) pc.addTrack(t, this.mic);
  }

  _newPc() {
    this._closePc();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    const from = this.role;
    pc.onicecandidate = (e) => e.candidate && this.sig?.send({ from, kind: 'ice', c: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        this.audio.srcObject = new MediaStream([e.track]);
        this.audio.play().catch(() => {}); // refused until the page has been touched; unlock() tries again
      } else {
        this.video.srcObject = new MediaStream([e.track]);
        this.video.play().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'connected') this.state = 'connected';
      else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        this.state = this.role === 'host' ? 'waiting' : 'connecting';
        this.hasGuest = false;
        this.crowd.reset();
      }
    };
    return pc;
  }

  _wire(/** @type {RTCDataChannel} */ dc) {
    this.dc = dc;
    dc.onmessage = (e) => this._onData(JSON.parse(e.data));
  }

  // host: a guest said hello; start a connection with the offer
  async _offer() {
    this.offeredAt = performance.now();
    await this.micReady; // so the offer carries our voice
    const pc = this._newPc();
    this.state = 'connecting';
    this.crowd.reset();
    this._wire(pc.createDataChannel('play', { ordered: false, maxRetransmits: 0 })); // late skeletons are worthless
    this._addOutgoing(pc);
    await pc.setLocalDescription(await pc.createOffer());
    this.sig.send({ from: 'host', kind: 'offer', d: pc.localDescription.toJSON() });
  }

  async _onSignal(/** @type {any} */ m) {
    if (m.kind === 'offer') {
      if (this.state === 'connected') return; // already paired; a stray hello must not restart it
      await this.micReady;
      const pc = this._newPc();
      pc.ondatachannel = (e) => this._wire(e.channel);
      await pc.setRemoteDescription(m.d);
      this._addOutgoing(pc); // uses the host's video and audio slots for ours
      await pc.setLocalDescription(await pc.createAnswer());
      this.sig.send({ from: 'guest', kind: 'answer', d: pc.localDescription.toJSON() });
      this.pending.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
      this.pending = [];
    } else if (m.kind === 'ice') this._addIce(m.c);
  }

  // The host handles answer and ice from the guest through the same signal channel.
  _hostSignal(/** @type {any} */ m) {
    if (m.kind === 'answer') {
      this.pc?.setRemoteDescription(m.d).then(() => {
        this.pending.forEach((c) => this.pc?.addIceCandidate(c).catch(() => {}));
        this.pending = [];
      });
    } else if (m.kind === 'ice') this._addIce(m.c);
  }

  _addIce(/** @type {any} */ c) {
    if (this.pc?.remoteDescription) this.pc.addIceCandidate(c).catch(() => {});
    else this.pending.push(c);
  }

  _send(/** @type {any} */ m) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(m));
  }

  _onData(/** @type {any} */ m) {
    if (m.ps && this.role === 'host') this._latest = m;
    else if (m.ping !== undefined) this._send({ pong: m.ping });
    else if (m.pong !== undefined) this.rtt = performance.now() - m.pong;
  }

  // ---------------------------------------------------------------- host: guests become players
  /**
   * @param {number} now @param {number} W @param {number} H
   * @param {number[]} usedSlots  colour slots of the host's own kids
   * @returns {import('./types.js').Player[]} the guests to add to g.players
   */
  remotePlayers(now, W, H, usedSlots) {
    if (this.role !== 'host') return [];
    if (this._latest) {
      this.crowd.ingest(this._latest, now, W, H, usedSlots);
      this._latest = null;
    }
    return this.crowd.tick(now);
  }

  /** The guest's cut-out, from the latest video frame. Call every update. */
  readGuestFrame() {
    const v = this.video;
    if (this.role !== 'host' || v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastVideoT) return;
    this.lastVideoT = v.currentTime;
    const w = v.videoWidth >> 1;
    const h = v.videoHeight;
    if (this.sample.width !== w * 2 || this.sample.height !== h) {
      this.sample.width = w * 2;
      this.sample.height = h;
      this.guestCut.width = w;
      this.guestCut.height = h;
    }
    this.sx.drawImage(v, 0, 0);
    const src = this.sx.getImageData(0, 0, w * 2, h);
    const out = this.gx.createImageData(w, h);
    decodeDoubleWide(src.data, w, h, out.data);
    this.gx.putImageData(out, 0, 0);
    this.hasGuest = true;
  }

  /** host: draw the guest into the scene, between the backdrop and the game. */
  drawGuest(/** @type {CanvasRenderingContext2D} */ ctx, W, H) {
    if (this.hasGuest) ctx.drawImage(this.guestCut, 0, 0, W, H);
  }

  // ---------------------------------------------------------------- guest: send ours, show theirs
  /**
   * @param {import('./types.js').Player[]} players  our own visible kids
   * @param {import('./cutout.js').Cutout | null} cutout  null when there is no cut-out this frame
   * @param {{ x: number, y: number, w: number, h: number } | null} rect  where the camera picture sits on our screen
   */
  sendFrame(players, cutout, rect, W, H, now) {
    if (this.role !== 'guest' || this.state !== 'connected') return;
    if (now - this.sentAt >= SEND_EVERY) {
      this.sentAt = now;
      this._send(packPlayers(players, W, H, this.seq++));
    }
    if (cutout && rect) {
      this.cutAt = now;
      this._drawFrame(cutout, rect, W, H);
    } else if (now - this.cutAt > 0.5 && now - this.blankAt >= 0.1) {
      // No cut-out (mouse mode, camera view, tracking lost): send an empty frame now and then. A canvas stream
      // only emits when something is drawn, and without frames the host's video never starts.
      this.blankAt = now;
      this.fx.fillStyle = '#000';
      this.fx.fillRect(0, 0, FRAME_W * 2, FRAME_H);
    }
  }

  _drawFrame(cutout, rect, W, H) {
    const sx = FRAME_W / W;
    const sy = FRAME_H / H;
    const r = { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy };
    const f = this.fx;
    f.fillStyle = '#000';
    f.fillRect(0, 0, FRAME_W * 2, FRAME_H);
    cutout.draw(f, r); // left: colour over black
    const h = this.hx;
    h.globalCompositeOperation = 'source-over';
    h.clearRect(0, 0, FRAME_W, FRAME_H);
    cutout.draw(h, r);
    h.globalCompositeOperation = 'source-in'; // keep the shape, make it white
    h.fillStyle = '#fff';
    h.fillRect(0, 0, FRAME_W, FRAME_H);
    f.drawImage(this.half, FRAME_W, 0); // right: white where the kid is, over black
  }

  /** guest: draw the host's picture full screen. Returns false until there is one. */
  drawHostPicture(/** @type {CanvasRenderingContext2D} */ ctx, W, H) {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return false;
    const s = Math.min(W / v.videoWidth, H / v.videoHeight);
    const w = v.videoWidth * s;
    const h = v.videoHeight * s;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
    return true;
  }

  /** One line for the screen, or '' when family play is off. */
  get label() {
    if (this.role === 'off') return '';
    const ping = (this.state === 'connected' && this.rtt ? `  (${Math.round(this.rtt)} ms)` : '') + (this.muted ? '  mic off' : '') + (this.micFailed ? '  no microphone' : '');
    if (this.role === 'host') {
      return this.state === 'connected' ? `Family room ${this.code}: connected${ping}` : `Family room ${this.code}: waiting for family. Open ${this.link}`;
    }
    return this.state === 'connected' ? `Playing with family, room ${this.code}${ping}` : `Looking for family room ${this.code}...`;
  }
}
