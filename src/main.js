/** @import { Game, Player } from './types.js' */
import { PoseTracker, MouseTracker } from './tracker.js';
import { LEVELS } from './levels/index.js';
import { sfx, unlock } from './audio.js';
import { Ease } from './ease.js';
import { loadArt, drawArt, registerArt } from './art.js';
import { text, drawSkeleton, drawHeart } from './draw.js';
import { Lobby, lateJoin } from './lobby.js';
import { Carousel, pickerChoices, carouselLayout, carouselCardAt, surprisePick, drawPicker } from './picker.js';
import { Cutout } from './cutout.js';
import { Backdrops } from './backdrops.js';
import { loadSavedCamera } from './camera.js';
import { defaultSettings } from './device.js';
import { createControls } from './controls.js';
import { Family } from './family.js';
import { SIGNAL_URL } from './online-config.js';
import { SetupCheck, shouldRunSetup, saveSetupDone, frameBrightness, judgeCamera, judgeLight, judgeDistance, judgeSpeed, judgeGraphics, softwareRendering, accelerationHelp } from './setup-check.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const settings = defaultSettings(params, navigator);
// The canvas is drawn at most at 1080p and scaled up by the browser: a 4K TV would otherwise mean four
// times the pixels to fill every frame for no visible gain from the sofa.
const MAX_W = 1920;
const MAX_H = 1080;

// ------------------------------------------------------------------ shared game object
const ease = new Ease(); // slows the game down when the kids keep failing
/** @type {Game & Record<string, any>} */
const g = {
  W: 1280,
  H: 720,
  u: 1,
  now: 0,
  players: [],
  team: { score: 0, hearts: 5, maxHearts: 5 },
  particles: [],
  round: 0,
  diff: 1,
  ease: 1,
  debug: params.has('debug'),
  fx: settings.fx, // glow effects: off with ?lite, on phones, or when drawing gets slow (see watchFrameRate)
  // What the kids are shown against: 'cutout' = just the kids, cut out and placed in a cartoon world;
  // 'camera' = the whole camera picture. Key B switches (handy if the cut-out ever misbehaves).
  view: params.get('view') === 'camera' ? 'camera' : 'cutout',
  skeleton: 'thin', // how the tracked skeleton is drawn over the kids: 'thin' | 'bold' | 'off' (key K)
  level: null,
  levelEnd: null,
  notice: '',
  toast: null, // a short message in the middle of the screen: { text, until }

  // Everyone who is visible AND playing (kids who sat out the lobby are excluded).
  activePlayers() {
    return this.players.filter((p) => p.present && !p.excluded);
  },
  score(p, pts, x, y) {
    if (p) {
      p.score += pts;
      ease.hit(this.now);
    } else ease.point(this.now);
    this.team.score += pts;
    this.particles.push({ x, y, vx: 0, vy: -90 * this.u, life: 1, max: 1, txt: `+${pts}`, color: p ? p.color : '#fff', size: 56 * this.u });
  },
  burst(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (120 + Math.random() * 380) * this.u;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7, color, size: (6 + Math.random() * 8) * this.u });
    }
  },
  miss() {
    ease.miss(this.now);
  },
  endLevel(msg) {
    if (!this.levelEnd) this.levelEnd = msg;
  },
};

let pose = null;
let mouse = null;
let tracker = null;
const cutout = new Cutout();
const backdrops = new Backdrops();
let cutoutReady = false;

// ------------------------------------------------------------------ state machine
// loading -> (setup, the first time) -> menu (arms out to join) -> pick (choose a level) -> intro -> play -> outro -> pick ...
let state = 'loading';
let stateT = 0;
let levelIdx = 0;
let lastPlayed = -1; // so "Surprise!" never picks the level just played
let levelT = 0;
const lobby = new Lobby({ hold: 3 });
const choices = pickerChoices(LEVELS);
const carousel = new Carousel({ n: choices.length });
let lastStep = -9; // when the carousel last scrolled (the middle card bounces)
// The cards as drawn this frame (for taps, and for the tests)
const pickCards = () => carouselLayout(choices.length, carousel.pos, g.W, g.H);
// Playing with family in another home (docs/ONLINE.md). Idle unless the grown-up opens a room (key O) or the page
// was opened with ?room=CODE.
const family = new Family({ canvas, search: location.search, origin: location.origin + location.pathname, signal: params.get('signal') || SIGNAL_URL });
let outroMsg = '';
let status = 'Loading...';
let setup = new SetupCheck();

function setState(s) {
  state = s;
  stateT = 0;
}

// Everyone the tracker knows, including kids who are briefly out of view (so they keep their place),
// and the family guests.
const localPeople = () => /** @type {Player[]} */ (tracker?.people?.players ?? g.players.filter((p) => !p.remote));
const everyone = () => [...localPeople(), ...family.crowd.players];

function toMenu() {
  for (const p of everyone()) p.excluded = false;
  g.level = null;
  lobby.reset();
  setState('menu');
}

// The level picker: the kids who joined choose what to play, and come back here after every level.
function toPick() {
  g.level = null;
  carousel.reset(lastPlayed >= 0 ? lastPlayed : 0); // the game just played is in the middle: "again!" is arms up
  setState('pick');
}

/** @param {number} i  a card in `choices` */
function choose(i) {
  const c = choices[i];
  if (!c) return;
  sfx.chime();
  startLevel(c.kind === 'level' ? c.index : surprisePick(LEVELS.length, lastPlayed));
}

// Difficulty = the round's step up, times the auto-ease.
function setDiff() {
  g.ease = ease.factor;
  g.diff = (1 + 0.25 * g.round) * ease.factor;
}

function startLevel(i) {
  levelIdx = i % LEVELS.length;
  lastPlayed = levelIdx;
  g.level = LEVELS[levelIdx];
  g.levelEnd = null;
  g.team.hearts = g.team.maxHearts;
  ease.newLevel();
  setDiff();
  g.level.start(g);
  levelT = 0;
  setState('intro');
}

// joinedIds: the kids who joined with arms out (everyone else sits out); null = include everyone.
function startGame(joinedIds = null) {
  g.team.score = 0;
  g.round = 0;
  ease.reset();
  for (const p of everyone()) {
    p.score = 0;
    p.excluded = joinedIds ? !joinedIds.includes(p.id) : false;
  }
  toPick();
}

// The grown-up's "skip": the next level in the list (wrapping round).
function nextLevel() {
  startLevel(levelIdx + 1);
}

const inLevel = () => state === 'intro' || state === 'play' || state === 'outro';
const reconnecting = () => (pose && tracker === pose && state !== 'loading' ? pose.reconnecting : null);

// ------------------------------------------------------------------ setup
function resize() {
  const s = Math.min(1, MAX_W / window.innerWidth, MAX_H / window.innerHeight);
  canvas.width = Math.round(window.innerWidth * s);
  canvas.height = Math.round(window.innerHeight * s);
  g.W = canvas.width;
  g.H = canvas.height;
  g.u = g.H / 1080;
  tracker?.setView(g.W, g.H);
  pose?.setView(g.W, g.H);
  mouse?.setView(g.W, g.H);
}

function useMouse() {
  mouse ??= new MouseTracker(canvas);
  tracker = mouse;
  g.players = [];
  resize();
}

async function boot() {
  for (const level of LEVELS) if (level.art) registerArt(level.art);
  loadArt();
  resize();
  if (params.has('mouse')) {
    useMouse();
    setState('menu');
    jumpToLevelFromUrl();
    return;
  }
  try {
    // ?model=lite|full forces a pose model, ?quality=high|medium|low|lowest pins the whole tracking ladder,
    // ?cam=wide|standard forces the picture size, ?worker=off tracks on the main thread
    pose = new PoseTracker({
      model: params.get('model'),
      quality: params.get('quality'),
      startQuality: settings.startQuality,
      cameraMode: params.get('cam'),
      worker: settings.worker,
    });
    status = 'Waking up the pose detector...';
    await pose.init();
    status = 'Starting the camera... (click Allow)';
    await pose.startCamera({ deviceId: loadSavedCamera(globalThis.localStorage) }); // remembers the camera picked with C
    tracker = pose;
    if (pose.cameraCount > 1) toast(`Camera: ${pose.cameraLabel}  (${pose.cameraCount} found, press C to switch)`, 5);
    resize();
    if (shouldRunSetup(params, globalThis.localStorage)) {
      setup = new SetupCheck();
      setState('setup');
    } else setState('menu');
  } catch (e) {
    console.error(e);
    g.notice = `No camera (${e.message || e}). Using the mouse instead.`;
    useMouse();
    setState('menu');
  }
  jumpToLevelFromUrl();
}

// ?level=<id> starts straight in that level: handy while making or tuning a level (see docs/ADDING-GAMES.md).
function jumpToLevelFromUrl() {
  const id = params.get('level');
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i >= 0) startLevel(i);
  else if (id) g.notice = `No level called "${id}". Levels: ${LEVELS.map((l) => l.id).join(', ')}`;
}

function toast(text, secs = 3.5) {
  g.toast = { text, until: g.now + secs };
}

let switchingCamera = false;
async function switchCamera() {
  if (switchingCamera) return; // a switch is already under way: pressing C again must not start a second one
  switchingCamera = true;
  try {
    const cam = await pose.nextCamera();
    toast(cam ? `Camera ${cam.index} of ${cam.count}: ${cam.label}` : 'Only one camera found (a phone webcam app has to be running first)', 4);
  } catch (e) {
    console.error(e);
    toast(`Could not switch camera: ${e.message || e}`, 5);
  } finally {
    switchingCamera = false;
  }
}

window.addEventListener('resize', resize);

// What the grown-up can do. Keys and the on-screen buttons (controls.js) both call these.
const actions = {
  start() {
    if (state === 'setup') toMenu(); // skip the setup check
    else if (state === 'menu') startGame();
    else if (state === 'pick') choose(carousel.index); // the game in the middle
  },
  next() {
    if (g.level && inLevel()) nextLevel();
  },
  // Back one step: from a level to the picker, from the picker to the join screen.
  menu() {
    if (state === 'setup') toMenu();
    else if (inLevel()) toPick();
    else if (state === 'pick') toMenu();
  },
  fullscreen() {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  },
  camera() {
    if (pose && tracker === pose) switchCamera();
  },
  family() {
    family.toggle();
    toast(family.active ? `Family room ${family.code}: ${family.role === 'host' ? 'ask them to open ' + family.link : 'looking for the host'}` : 'Family room closed', 6);
  },
};

window.addEventListener('keydown', (e) => {
  unlock();
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') {
    actions.start();
    e.preventDefault();
  } else if (k === 'n') actions.next();
  else if ((k === 'arrowleft' || k === 'arrowright') && state === 'pick') scroll(k === 'arrowleft' ? -1 : 1);
  else if (k >= '1' && k <= '9' && Number(k) <= LEVELS.length && state !== 'loading') {
    if (state === 'menu') g.team.score = 0;
    startLevel(Number(k) - 1);
  } else if (k === 'escape') actions.menu();
  else if (k === 'f') actions.fullscreen();
  else if (k === 'd') g.debug = !g.debug;
  else if (k === 'c') actions.camera();
  else if (k === 'o' && state !== 'loading') actions.family();
  else if (k === 'v') family.toggleMute();
  else if (k === 'b') g.view = g.view === 'cutout' ? 'camera' : 'cutout';
  else if (k === 'k') g.skeleton = { thin: 'bold', bold: 'off', off: 'thin' }[g.skeleton];
  else if (k === 'm' && state !== 'loading') {
    if (tracker === mouse) {
      if (pose) {
        tracker = pose;
        g.players = [];
        lobby.reset();
        resize();
      }
    } else {
      useMouse();
      lobby.reset();
    }
  }
});
window.addEventListener('pointerdown', unlock);
// A grown-up can tap (or click) the picker: a side card scrolls to it, the middle card plays.
canvas.addEventListener('pointerdown', (e) => {
  if (state === 'setup') return toMenu(); // a tap skips the setup check
  if (state !== 'pick') return;
  const r = canvas.getBoundingClientRect();
  const card = carouselCardAt(pickCards(), { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height });
  if (!card) return;
  if (card.i === carousel.index) choose(card.i);
  else scroll(Math.sign(card.off) * Math.max(1, Math.round(Math.abs(card.off))));
});

function scroll(d) {
  carousel.step(d);
  lastStep = g.now;
  sfx.whoosh();
}

createControls(actions, {
  state: () => state,
  mouseIsPlaying: () => !!mouse && tracker === mouse,
  hasCamera: () => !!pose && tracker === pose,
  family: () => family.active,
});

// Offline play on the hosted site: a service worker keeps a copy of the game. Only over HTTPS (GitHub Pages),
// so the local server and the tests always run the files on disk.
if (location.protocol === 'https:' && 'serviceWorker' in navigator && !params.has('nosw')) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch((e) => console.warn('offline copy unavailable', e));
}

// ------------------------------------------------------------------ update
let cutoutKey = '';
let cutoutT = 0;
function update(dt) {
  const local = tracker ? tracker.update(g.now) : [];
  g.players = local;
  if (family.role === 'host') {
    family.readGuestFrame();
    g.players = [...local, ...family.remotePlayers(g.now, g.W, g.H, localPeople().map((p) => p.slot))];
  }
  // The camera or the tracking is being reconnected (tracker.js heals itself): the game waits, so nobody loses
  // hearts or time to a frozen picture, and carries on where it was once it is back.
  if (reconnecting()) return;
  stateT += dt;
  admitPlayers(dt);
  // Cut the kids out of the camera picture (pose silhouettes + motion safety net). Only worth redoing when
  // the camera has a new picture or tracking a new answer (about 30 times a second, not every screen refresh);
  // in between, the last cut-out is drawn again.
  cutoutT += dt;
  const key = pose ? `${pose.video.currentTime}:${pose.frameSeq}` : '';
  let cutoutFresh = false;
  if (g.view !== 'cutout' || !pose || tracker !== pose) cutoutReady = false;
  else if (key !== cutoutKey) {
    cutoutKey = key;
    cutoutFresh = cutout.update(pose.video, pose.maskLow, pose.maskW, pose.maskH, cutoutT);
    cutoutReady = cutoutFresh || cutoutReady;
    cutoutT = 0;
  }
  if (family.role === 'guest') {
    family.sendFrame(local, cutoutFresh ? cutout : null, cutoutFresh ? pose.videoRect() : null, g.W, g.H, g.now);
    if (family.guestView) return; // the host runs the game; we only send our kids and show its picture
  }

  for (const q of g.particles) {
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (!q.txt) q.vy += 900 * g.u * dt;
  }
  g.particles = g.particles.filter((q) => q.life > 0);

  if (state === 'setup') {
    updateSetup(dt);
  } else if (state === 'menu') {
    // Arms out for 3s starts the game with exactly the kids who have their arms out.
    const joinedIds = lobby.update(g.activePlayers(), g.now, dt);
    if (joinedIds) startGame(joinedIds);
  } else if (state === 'pick') {
    const { step, chosen } = carousel.update(g.activePlayers(), dt);
    if (step) {
      lastStep = g.now;
      sfx.whoosh();
    }
    if (chosen >= 0) choose(chosen);
  } else if (state === 'intro') {
    if (stateT > 3) {
      sfx.go();
      setState('play');
    }
  } else if (state === 'play') {
    levelT += dt;
    ease.update(g.now, g.activePlayers().length > 0);
    setDiff();
    g.level.update(g, dt);
    if (g.levelEnd || levelT >= g.level.duration) {
      outroMsg = g.levelEnd || 'Level complete!';
      if (g.levelEnd) {
        sfx.aww();
        ease.failedLevel(g.now); // out of hearts: the replay is a bit easier
      } else sfx.fanfare();
      setState('outro');
    }
  } else if (state === 'outro') {
    if (stateT > 4) toPick(); // back to the picker, to choose again (the same level is one card away)
  }
}

// The setup check: how bright the picture is comes from a tiny copy of the camera frame, twice a second.
const shot = document.createElement('canvas');
shot.width = 32;
shot.height = 18;
const shotCtx = shot.getContext('2d', { willReadFrequently: true });
let brightness = null;
let shotT = 0;
function updateSetup(dt) {
  const v = pose.video;
  const picture = v.readyState >= 2 && v.videoWidth > 0;
  shotT -= dt;
  if (picture && shotT <= 0) {
    shotT = 0.5;
    shotCtx.drawImage(v, 0, 0, shot.width, shot.height);
    brightness = frameBrightness(shotCtx.getImageData(0, 0, shot.width, shot.height).data);
  }
  setup.update(
    {
      camera: judgeCamera(picture, pose.cameraLabel),
      light: judgeLight(picture ? brightness : null),
      distance: judgeDistance(g.activePlayers(), g.W, g.H, pose.frameSeq),
      speed: judgeSpeed(pose.detectMs, pose.cameraFps, pose.frameSeq),
      graphics: judgeGraphics(gpuName(), pose.delegate),
    },
    dt,
  );
  if (setup.passed) saveSetupDone(globalThis.localStorage); // remembered: not shown again
  if (setup.finished) toMenu();
}

// People who show up while a game is under way only watch (they are in the picture, but can't score or be hit),
// so a parent walking past or a visiting cousin never barges in. To play they hold their arms out for 2 s.
// A kid who was playing and steps out of view is recognised when they come back (people.js) and carries on.
function admitPlayers(dt) {
  const playing = state !== 'menu' && state !== 'loading';
  for (const p of g.players) {
    if (p.isNew) {
      p.isNew = false;
      if (playing) p.excluded = true;
    }
    if (playing && lateJoin(p, dt)) {
      toast('A new player joined!', 3);
      sfx.star();
    }
  }
}

// If the screen can't keep up (under ~40 frames a second for a few seconds), turn the glow effects off.
let slowFor = 0;
function watchFrameRate(dt) {
  if (!g.fx || settings.fxPinned || state === 'loading') return;
  slowFor = dtSmooth > 1 / 40 ? slowFor + dt : 0;
  if (slowFor > 4) {
    g.fx = false;
    console.warn('drawing is slow, glow effects off');
  }
}

// ------------------------------------------------------------------ render
// Which cartoon world to show: one per level, a meadow in the menu and the picker.
function backdropId() {
  if (state === 'menu' || state === 'pick' || state === 'loading' || state === 'setup' || !g.level) return 'menu';
  return typeof g.level.backdrop === 'string' ? g.level.backdrop : g.level.id;
}

function drawBackground() {
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, g.W, g.H);
  const r = pose && tracker === pose ? pose.videoRect() : null;
  const camera = r && pose.video.readyState >= 2;

  if (g.view === 'camera' && camera) {
    // the whole camera picture, at full brightness so the kids see themselves in full colour
    ctx.save();
    ctx.translate(r.x + r.w, r.y);
    ctx.scale(-1, 1);
    ctx.drawImage(pose.video, 0, 0, r.w, r.h);
    ctx.restore();
    if (g.level && state !== 'menu') {
      ctx.globalAlpha = 0.07; // just a hint of the level's colour, not a veil over the kids
      ctx.fillStyle = g.level.color;
      ctx.fillRect(0, 0, g.W, g.H);
      ctx.globalAlpha = 1;
    }
    return;
  }
  // cartoon world, with the kids cut out of the camera picture and placed in it
  const custom = g.level && inLevel() && typeof g.level.backdrop === 'object' ? g.level.backdrop : undefined;
  backdrops.draw(ctx, backdropId(), g.W, g.H, g.now, custom);
  if (camera && cutoutReady) cutout.draw(ctx, r);
  family.drawGuest(ctx, g.W, g.H);
}
function drawParticles() {
  for (const q of g.particles) {
    const a = Math.max(0, q.life / q.max);
    ctx.globalAlpha = a;
    if (q.txt) text(ctx, q.txt, q.x, q.y, q.size, { color: q.color });
    else {
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * a + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  const u = g.u;
  const L = g.level;
  text(ctx, L.title, 40 * u, 55 * u, 48 * u, { align: 'left' });
  // timer bar
  const bw = g.W * 0.3;
  const bx = (g.W - bw) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx, 28 * u, bw, 22 * u);
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx, 28 * u, bw * Math.max(0, 1 - levelT / L.duration), 22 * u);
  // team score
  drawArt(ctx, 'star', g.W - 220 * u, 55 * u, 64 * u);
  text(ctx, String(g.team.score), g.W - 40 * u, 55 * u, 64 * u, { align: 'right', color: '#ffe14d' });
  if (L.hearts) {
    for (let i = 0; i < g.team.maxHearts; i++) drawHeart(ctx, g.W - (60 + i * 62) * u, 130 * u, 28 * u, i < g.team.hearts);
  }
}

function drawPlayerCount() {
  const n = g.activePlayers().length;
  const word = state === 'menu' ? 'spotted' : 'playing';
  text(ctx, n ? `${n} player${n > 1 ? 's' : ''} ${word}!` : 'Step into view...', g.W / 2, g.H - 60 * g.u, 54 * g.u);
}

// A row per check: a tick, a cross or dots, and what to do about it. Kept to the top half so the kids stay visible.
function drawSetup() {
  const u = g.u;
  ctx.fillStyle = 'rgba(8,12,30,0.35)';
  ctx.fillRect(0, 0, g.W, g.H);
  text(ctx, setup.passed ? 'All set! Let\'s play!' : 'Quick setup check', g.W / 2, g.H * 0.08, 80 * u, { color: setup.passed ? '#7dff6b' : '#ffe14d' });
  const names = { camera: 'Camera', light: 'Light', distance: 'Distance', speed: 'Speed', graphics: 'Graphics' };
  const w = Math.min(g.W - 80 * u, 1300 * u);
  const x0 = (g.W - w) / 2;
  setup.items.forEach((c, i) => {
    const y = g.H * 0.17 + i * 74 * u;
    ctx.fillStyle = 'rgba(8,12,30,0.65)';
    ctx.fillRect(x0, y - 32 * u, w, 64 * u);
    const mark = c.ok === true ? '✓' : c.ok === false ? '✗' : '…';
    const color = c.ok === true ? '#7dff6b' : c.ok === false ? '#ff8a80' : '#cfd6e6';
    text(ctx, mark, x0 + 40 * u, y, 44 * u, { color });
    text(ctx, names[c.name] ?? c.name, x0 + 80 * u, y, 36 * u, { align: 'left', color });
    text(ctx, c.text, x0 + 300 * u, y, 32 * u, { align: 'left' });
  });
  if (setup.items.some((c) => c.name === 'graphics' && c.ok === false)) {
    text(ctx, accelerationHelp(navigator.userAgent), g.W / 2, g.H * 0.17 + setup.items.length * 74 * u, 30 * u, { color: '#ffe14d' });
  }
  const how = settings.mobile ? 'tap the screen' : 'press SPACE or tap';
  const foot = setup.overdue ? `Fix what is marked ✗ and it will carry on by itself, or ${how} to play anyway` : `Grown-ups: ${how} to skip`;
  text(ctx, foot, g.W / 2, g.H - 50 * u, 32 * u, { color: setup.overdue ? '#ffe14d' : '#cfd6e6' });
}

// The friendly screen while the camera or the tracking is put right (see PoseTracker._heal). After a few seconds
// it suggests what a grown-up can check, in case it can't fix itself.
function drawReconnecting() {
  const u = g.u;
  const what = reconnecting();
  const secs = g.now - pose.reconnectingSince;
  ctx.fillStyle = 'rgba(8,12,30,0.7)';
  ctx.fillRect(0, 0, g.W, g.H);
  ctx.lineWidth = 16 * u;
  ctx.strokeStyle = '#7dff6b';
  ctx.beginPath();
  const a = g.now * 5;
  ctx.arc(g.W / 2, g.H * 0.36, 60 * u, a, a + Math.PI * 1.3);
  ctx.stroke();
  text(ctx, what === 'camera' ? 'Reconnecting the camera...' : 'Waking up the pose detector...', g.W / 2, g.H * 0.56, 72 * u, { color: '#ffe14d' });
  text(ctx, 'Hold on, the game will carry on by itself.', g.W / 2, g.H * 0.66, 44 * u);
  if (secs > 6) {
    const hint = what === 'camera' ? 'Grown-ups: check the camera is plugged in and no other app is using it.' : 'Grown-ups: closing other tabs and apps can help.';
    text(ctx, hint, g.W / 2, g.H * 0.76, 32 * u, { color: '#cfd6e6' });
  }
}

function render() {
  const u = g.u;
  if (family.guestView && family.drawHostPicture(ctx, g.W, g.H)) return; // the host's picture already carries the room label
  drawBackground();

  if (state === 'loading') {
    text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.4, 110 * u);
    text(ctx, status, g.W / 2, g.H * 0.55, 48 * u);
    return;
  }

  if (g.level && inLevel()) g.level.draw(g, ctx);
  for (const p of g.players) drawSkeleton(ctx, p, g);
  drawParticles();

  if (state === 'setup') drawSetup();
  else if (state === 'menu') {
    ctx.fillStyle = 'rgba(8,12,30,0.3)';
    ctx.fillRect(0, 0, g.W, g.H);
    // All the words live in a band at the top so they never cover the kids.
    text(ctx, 'Kids Camera Game', g.W / 2, g.H * 0.07, 96 * u, { color: '#ffe14d' });
    text(ctx, 'Arms out like an airplane for 3 seconds to JOIN!', g.W / 2, g.H * 0.15, 44 * u);
    text(ctx, "Stand back so the camera sees all of you. Anyone who doesn't join sits this one out.", g.W / 2, g.H * 0.2, 26 * u);
    // Who has joined: a green countdown ring over each airplane kid, a nudge over the others.
    for (const p of g.activePlayers()) {
      const x = p.px[0].x;
      const y = Math.max(g.H * 0.3, p.px[0].y - Math.max(120 * u, p.shoulderW * 1.0));
      if (lobby.isJoined(p.id)) {
        ctx.lineWidth = 14 * u;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 52 * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#7dff6b';
        ctx.beginPath();
        ctx.arc(x, y, 52 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lobby.progress);
        ctx.stroke();
        text(ctx, String(lobby.secondsLeft), x, y, 60 * u, { color: '#7dff6b' });
        text(ctx, '✓ IN', x, y - 85 * u, 36 * u, { color: '#7dff6b' });
      } else {
        text(ctx, 'arms out to join', x, y, 28 * u, { color: '#cfd6e6' });
      }
    }
    if (lobby.joined.length) {
      const n = lobby.joined.length;
      text(ctx, `Starting with ${n} player${n > 1 ? 's' : ''}... keep your arms out!`, g.W / 2, g.H * 0.86, 46 * u, { color: '#7dff6b' });
    }
    drawPlayerCount();
    text(ctx, settings.mobile ? 'grown-ups: tap the screen for the buttons (Start, Camera, Full screen)' : 'grown-ups: SPACE starts with everyone, or tap or move the mouse for buttons', g.W - 30 * u, g.H - 30 * u, 24 * u, { align: 'right' });
    if (pose && tracker === pose && pose.isPortrait) text(ctx, 'The camera picture is upright (portrait). Turn the phone sideways for a much wider view.', g.W / 2, g.H * 0.26, 28 * u, { color: '#ffe14d' });
    if (g.notice) text(ctx, g.notice, g.W / 2, g.H * 0.26, 28 * u, { color: '#ffb3b3' });
    // the setup check only runs once, but acceleration can be switched off later: say so every time
    if (pose && tracker === pose && softwareRendering(gpuName(), pose.delegate)) {
      text(ctx, `The game may lag: graphics acceleration is off. ${accelerationHelp(navigator.userAgent)}`, g.W / 2, g.H * 0.3, 26 * u, { color: '#ffe14d' });
    }
    if (tracker === mouse) text(ctx, 'Mouse mode: move = body & hands, click = jump, Q/W/E = poses', g.W / 2, g.H * 0.8, 28 * u);
  } else if (state === 'pick') {
    ctx.fillStyle = 'rgba(8,12,30,0.3)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, 'Pick a game!', g.W / 2, g.H * 0.07, 84 * u, { color: '#ffe14d' });
    drawPicker(ctx, g, choices, carousel, pickCards(), lastStep);
  } else if (state === 'intro') {
    ctx.fillStyle = 'rgba(8,12,30,0.4)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, `Level ${levelIdx + 1}`, g.W / 2, g.H * 0.22, 70 * u, { color: '#ffe14d' });
    text(ctx, g.level.title, g.W / 2, g.H * 0.36, 130 * u);
    text(ctx, g.level.hint, g.W / 2, g.H * 0.5, 50 * u);
    text(ctx, String(Math.max(1, Math.ceil(3 - stateT))), g.W / 2, g.H * 0.7, 200 * u, { color: '#7dff6b' });
    drawPlayerCount();
  } else if (state === 'play') {
    drawHud();
  } else if (state === 'outro') {
    drawHud();
    ctx.fillStyle = 'rgba(8,12,30,0.4)';
    ctx.fillRect(0, 0, g.W, g.H);
    text(ctx, outroMsg, g.W / 2, g.H * 0.3, 100 * u, { color: '#ffe14d' });
    text(ctx, `Team score: ${g.team.score}`, g.W / 2, g.H * 0.45, 70 * u);
    // each kid's stars, best first, side by side
    const ranked = g.players.filter((p) => !p.excluded).sort((a, b) => b.score - a.score);
    ranked.forEach((p, i) => text(ctx, `${i === 0 ? '👑 ' : ''}★ ${p.score}`, g.W * ((i + 1) / (ranked.length + 1)), g.H * 0.62, 64 * u, { color: p.color }));
  }

  if (reconnecting()) drawReconnecting();
  if (family.active) text(ctx, family.label, 30 * u, g.H - 30 * u, 26 * u, { align: 'left' });

  if (g.toast && g.now < g.toast.until) {
    ctx.font = `800 ${36 * u}px "Trebuchet MS", system-ui, sans-serif`;
    const w = ctx.measureText(g.toast.text).width + 60 * u;
    ctx.fillStyle = 'rgba(8,12,30,0.75)';
    ctx.fillRect((g.W - w) / 2, 80 * u, w, 64 * u);
    text(ctx, g.toast.text, g.W / 2, 112 * u, 36 * u);
  }

  if (g.debug) {
    // top left, on a solid panel and drawn last, so the game's own text and the buttons can't cover it
    const lines = [...debugLines(), `keys: D debug  B cut-out/camera  K skeleton  C camera  F fullscreen  M mouse  N next  1-${LEVELS.length} level  Esc menu`];
    const size = 24 * u;
    ctx.font = `600 ${size}px "Trebuchet MS", system-ui, sans-serif`;
    const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 30 * u;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(10 * u, 10 * u, w, lines.length * size * 1.3 + 20 * u);
    lines.forEach((s, i) => text(ctx, s, 25 * u, 20 * u + (i + 0.5) * size * 1.3, size, { align: 'left', stroke: 'transparent', weight: 600 }));
    // what the game thinks each kid is doing (handy when a pose won't register)
    for (const p of g.activePlayers()) {
      const on = Object.entries(p.pose).filter(([, v]) => v).map(([k]) => k).join(' + ') || 'no pose';
      text(ctx, `on ${on}   (torso/shoulders ${(p.torso / p.shoulderW).toFixed(1)})`, p.px[0].x, p.px[0].y - 120 * u, 24 * u, { color: p.color });
    }
  }
}

// ------------------------------------------------------------------ debug (?debug or key D)
// The same facts go on screen and, every 5 s, to the browser console (F12 > Console) as one line a grown-up
// can copy and paste when reporting a problem. Frame and tracking rates are counted over the 5 s, not
// derived from dt (which is capped at 50 ms, so it can never show under 20 fps).
const dbg = { t: 0, frames: 0, seq: 0, fps: 0, tracked: 0, gpu: '' };
function gpuName() {
  if (dbg.gpu) return dbg.gpu;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    dbg.gpu = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)) || 'no WebGL';
  } catch {
    dbg.gpu = 'unknown';
  }
  return dbg.gpu;
}
function debugLines() {
  const cam = pose && tracker === pose;
  const s = cutout.stats;
  const browser = navigator.userAgent.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/g)?.pop() ?? navigator.userAgent;
  return [
    `fps ${dbg.fps}   tracked ${dbg.tracked}/s   round trip ${tracker?.detectMs?.toFixed?.(0)} ms (model ${pose?.modelMs?.toFixed(0) ?? '-'} ms)`,
    `tracking ${tracker?.delegate}${cam ? `, ${pose.useWorker ? 'worker' : 'main thread'}, ${pose.quality.name} (${pose.modelName})` : ''}   players ${g.activePlayers().length}   state ${state}   diff ${g.diff.toFixed(2)}`,
    cam ? `camera ${pose.cameraLabel} ${pose.video.videoWidth}x${pose.video.videoHeight} (${pose.mode}, ${pose.cameraFps ? pose.cameraFps.toFixed(0) + ' fps' : 'measuring'})` : 'camera: none',
    `cut-out ${g.view === 'cutout' && cutoutReady ? `${(s.coverage * 100).toFixed(0)}% of screen, pose mask ${s.poseActive ? 'ON' : 'LOST'}` : 'off'}   screen ${g.W}x${g.H}   fx ${g.fx ? 'on' : 'off'}`,
    `${browser}   gpu ${gpuName()}`,
  ];
}
function watchDebug(now) {
  dbg.frames++;
  if (!dbg.t) dbg.t = now;
  if (now - dbg.t < 5) return;
  const seq = pose?.frameSeq ?? 0;
  dbg.fps = Math.round(dbg.frames / (now - dbg.t));
  dbg.tracked = Math.round(((seq - dbg.seq) / (now - dbg.t)) * 10) / 10;
  dbg.t = now;
  dbg.frames = 0;
  dbg.seq = seq;
  if (g.debug) console.log(`[kids-camera-games debug] ${debugLines().join(' | ')}`);
}

// ------------------------------------------------------------------ main loop
let last = 0;
let dtSmooth = 0.016;
function frame(ts) {
  requestAnimationFrame(frame);
  const now = ts / 1000;
  const dt = Math.min(0.05, now - last || 0.016);
  last = now;
  dtSmooth = dtSmooth * 0.95 + dt * 0.05;
  g.now = now;
  update(dt);
  watchFrameRate(dt);
  watchDebug(now);
  render();
}

requestAnimationFrame(frame);
boot();

// handy for debugging / automated tests
/** @type {any} */ (window).__game = { g, levels: LEVELS, startLevel, cutout, backdrops, get state() { return state; }, get tracker() { return tracker; }, get cutoutReady() { return cutoutReady; }, get carousel() { return carousel; }, get setup() { return setup; }, pickCards, family };
