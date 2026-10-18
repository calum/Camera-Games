// Family play: the WebRTC and screen glue around online.js. Two roles share one scene:
//
//   host   the home that runs the game (the TV). Turns the guest's skeletons into players, draws the guest's
//          cut-out into the scene, and sends its finished picture back.
//   guest  the other home. Runs its own tracking and cut-out as usual, sends skeletons + cut-out, and shows
//          the host's picture full screen.
//
// Signalling (the two browsers finding each other) goes through a Signal: the Cloudflare pairing function
// (cloudflare/worker.js) when a URL is configured, or a BroadcastChannel so two windows on one computer can pair
// with no server at all. Video, voices and skeletons then go directly between the browsers. See docs/ONLINE.md.
import { soundStream } from './audio.js';
import { RemoteCrowd, decodeDoubleWide, makeRoomCode, normaliseCode, packPlayers } from './online.js';

// Used when the pairing function cannot be asked: public STUN only (works for most home routers, no relay).
const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
const FRAME_W = 640; // one half of the cut-out frame; the frame sent is twice as wide
const FRAME_H = 360;
const SEND_EVERY = 1 / 30; // seconds between skeleton messages

/** Pairing messages between two windows of one browser that know the same room code. */
class BroadcastSignal {
  constructor(/** @type {string} */ code, /** @type {(m: any) => void} */ onMessage) {
    this.up = true;
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

/**
 * Pairing messages through the Cloudflare function: a WebSocket to the room. Reconnects by itself, so a guest
 * who arrives before the host (the room does not exist yet) just keeps trying until it does. The host brings the
 * key it opened the room with, so its reconnects get back in and a stranger with the code cannot take its place.
 * The function's own first message on each socket is the STUN/TURN servers, handed to onIce.
 */
class SocketSignal {
  constructor(
    /** @type {string} */ base,
    /** @type {string} */ code,
    /** @type {string} */ role,
    /** @type {(m: any) => void} */ onMessage,
    /** @type {(ice: any[]) => void} */ onIce,
  ) {
    const key = role === 'host' ? `&key=${hostKey()}` : '';
    this.url = `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/room/${code}?role=${role}${key}`;
    this.onMessage = onMessage;
    this.onIce = onIce;
    this.up = false;
    this.closed = false;
    this.ws = null;
    this.timer = 0;
    this._open();
  }
  _open() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.timer = setTimeout(() => this._open(), 2000);
      return;
    }
    this.ws = ws;
    ws.onopen = () => (this.up = true);
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.from === 'server') Array.isArray(m.ice) && m.ice.length && this.onIce(m.ice);
        else this.onMessage(m);
      } catch {
        // not one of ours
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.up = false;
      if (e.code === 4000) this.closed = true; // a newer host took this room over: this page is stale
      else if (!this.closed) this.timer = setTimeout(() => this._open(), 2000);
    };
  }
  send(/** @type {any} */ m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.up = false;
  }
}

/** A fresh random key for each room a host opens (it never leaves this page and the pairing function). */
function hostKey() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class Family {
  /**
   * @param {{ canvas: HTMLCanvasElement, search: string, origin?: string, signal?: string }} o
   *   signal: URL of the pairing function; empty = two windows on this computer only
   */
  constructor({ canvas, search, origin = '', signal = '' }) {
    this.canvas = canvas;
    this.origin = origin;
    this.signalBase = signal;
    this.signalOverride = new URLSearchParams(search).has('signal'); // then the guest's link has to carry it too
    this.iceServers = [];
    this.iceReady = Promise.resolve();
    this._iceArrived = () => {};
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
    /** @type {HTMLAudioElement[]} the other home's voices, and (on the guest) the host's game sounds */
    this.audios = [];
    this.mic = null; // our microphone stream, when we have one
    this.micReady = Promise.resolve(null);
    this.muted = false;
    this.micFailed = false;
    // Browsers hold back sound until the page has been touched; the first key or tap lets the voices through.
    const unlock = () => this.audios.forEach((a) => a.play().catch(() => {}));
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
    /** @type {ImageData | null} */ this.guestPixels = null;
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
    return `${this.origin}?room=${this.code}${this.signalOverride ? `&signal=${encodeURIComponent(this.signalBase)}` : ''}`;
  }

  _signal(/** @type {string} */ code, /** @type {string} */ role, /** @type {(m: any) => void} */ onMessage) {
    if (!this.signalBase) return new BroadcastSignal(code, onMessage);
    return new SocketSignal(this.signalBase, code, role, onMessage, (ice) => {
      this.iceServers = ice;
      this._iceArrived();
    });
  }

  /**
   * The servers that let the connection get through home routers. The pairing function sends them as the first
   * message on the room socket (only a browser in a live room gets relay credentials); until then, plain STUN.
   */
  _getIce() {
    this._iceArrived = () => {};
    if (!this.signalBase) {
      this.iceServers = []; // two windows on one computer need none
      this.iceReady = Promise.resolve();
      return;
    }
    this.iceServers = FALLBACK_ICE;
    this.iceReady = new Promise((done) => {
      const timer = setTimeout(done, 4000); // an older pairing function never sends them
      this._iceArrived = () => {
        clearTimeout(timer);
        done(undefined);
      };
    });
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
    this._getIce();
    this.sig = this._signal(code, 'host', (m) => {
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
    this._getIce();
    this.sig = this._signal(code, 'guest', (m) => m.from === 'host' && this._onSignal(m));
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
    this.audios.forEach((a) => (a.srcObject = null));
    this.audios = [];
    this.hasGuest = false;
  }

  _addOutgoing(/** @type {RTCPeerConnection} */ pc) {
    for (const t of this.out.getTracks()) pc.addTrack(t, this.out);
    if (this.mic) for (const t of this.mic.getAudioTracks()) pc.addTrack(t, this.mic);
    // The host also sends the game's own sounds, so the guest hears the pops and cheers too.
    const sounds = this.role === 'host' ? soundStream() : null;
    if (sounds) for (const t of sounds.getAudioTracks()) pc.addTrack(t, sounds);
  }

  _newPc() {
    this._closePc();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    const from = this.role;
    pc.onicecandidate = (e) => e.candidate && this.sig?.send({ from, kind: 'ice', c: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        const a = new Audio(); // one element per sound, so voices and game sounds play together
        a.srcObject = new MediaStream([e.track]);
        this.audios.push(a);
        a.play().catch(() => {}); // refused until the page has been touched; unlock() tries again
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
    await Promise.all([this.micReady, this.iceReady]); // so the offer carries our voice and the right servers
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
      await Promise.all([this.micReady, this.iceReady]);
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
    if (this.guestPixels?.width !== w || this.guestPixels.height !== h) this.guestPixels = this.gx.createImageData(w, h);
    const out = this.guestPixels; // reused: a fresh one every video frame is ~1 MB of garbage
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
      if (this.state === 'connected') return `Family room ${this.code}: connected${ping}`;
      if (!this.sig?.up) return `Family room ${this.code}: reaching the pairing service...`;
      return `Family room ${this.code}: waiting for family. Open ${this.link}`;
    }
    return this.state === 'connected' ? `Playing with family, room ${this.code}${ping}` : `Looking for family room ${this.code}...`;
  }
}
