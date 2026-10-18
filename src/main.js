/** @import { Game, Player } from './types.js' */
import { PoseTracker, MouseTracker } from './tracker.js';
import { LEVELS } from './levels/index.js';
import { sfx, unlock, music } from './audio.js';
import { moodFor, musicOn, saveMusicOn } from './music.js';
import { Ease } from './ease.js';
import { loadArt, drawArt, registerArt } from './art.js';
import { text, drawSkeleton, drawHeart, popScale } from './draw.js';
import { Lobby, lateJoin } from './lobby.js';
import { Carousel, pickerChoices, carouselLayout, carouselCardAt, surprisePick, drawPicker } from './picker.js';
import { Cutout } from './cutout.js';
import { Backdrops } from './backdrops.js';
import { loadSavedCamera } from './camera.js';
import { defaultSettings } from './device.js';
import { createControls } from './controls.js';
import { Family } from './family.js';
import { SIGNAL_URL } from './online-config.js';
import { DebugRecorder } from './debug-record.js';
import { parseRecording, recordingStart } from './recording.js';
import { ReplayTracker } from './replay.js';
import { Calibration, shouldCalibrate } from './calibrate.js';
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
    note('score', { pts, player: p?.id ?? null });
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
    // plus one ring that spreads out from the spot, so a pop reads as a pop even in the corner of your eye
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, color, size: (50 + n * 3) * this.u, ring: true });
  },
  // A shower of paper confetti from the top of the screen (the end of a level that went well).
  confetti(n = 60) {
    const colors = ['#ff5a7a', '#ffd21f', '#4dd2ff', '#7dff6b', '#c77dff', '#ff9a3d'];
    for (let i = 0; i < n; i++) {
      const life = 2.6 + Math.random() * 1.2;
      this.particles.push({ x: Math.random() * this.W, y: -Math.random() * 300 * this.u, vx: (Math.random() - 0.5) * 120 * this.u, vy: (150 + Math.random() * 200) * this.u, life, max: life, color: colors[i % colors.length], size: (10 + Math.random() * 8) * this.u, paper: Math.random() * 6 });
    }
  },
  miss() {
    note('miss');
    ease.miss(this.now);
  },
  endLevel(msg) {
    if (!this.levelEnd) note('end', { msg });
    if (!this.levelEnd) this.levelEnd = msg;
  },
};

let pose = null;
let mouse = null;
/** @type {ReplayTracker | null} */
let replay = null; // ?replay, or a recording dropped on the page: plays a debug recording instead of the camera
let tracker = null;
const cutout = new Cutout();
const backdrops = new Backdrops();
let cutoutReady = false;

// ------------------------------------------------------------------ state machine
// loading -> (setup, the first time) -> menu (arms out to join) -> calibrate (show the play space) -> pick (choose a
// level) -> intro -> play -> outro -> pick ...
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
// The play space (calibrate.js): measured once per start, before the first picker, and again after a camera switch
// (a new picture, a new space) or when a grown-up presses P in the picker. ?nocal and ?level= skip it.
let calibration = new Calibration();
let calibrated = !shouldCalibrate(params);

function setState(s) {
  state = s;
  stateT = 0;
  note('state', { state: s, level: g.level?.id ?? null });
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
  if (!calibrated && tracker !== mouse) return toCalibrate(); // a mouse has no room to measure
  g.level = null;
  carousel.reset(lastPlayed >= 0 ? lastPlayed : 0); // the game just played is in the middle: "again!" is arms up
  setState('pick');
}

function toCalibrate() {
  g.level = null;
  calibration = new Calibration();
  setState('calibrate');
}

// The play space is known (or a grown-up skipped the rest): the levels keep to it, and on to the picker.
function calibrationDone() {
  if (calibration.sides.left || calibration.sides.right) g.area = calibration.area;
  calibrated = true;
  note('area', { ...g.area });
  if (calibration.sides.left || calibration.sides.right) sfx.fanfare();
  toPick();
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
  if (params.has('replay')) {
    useReplay(null);
    g.notice = 'Replay: drop a recording (.json) on the page, or press L to choose one';
    setState('menu');
    return;
  }
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
  note('toast', { text });
}

let switchingCamera = false;
async function switchCamera() {
  if (switchingCamera) return; // a switch is already under way: pressing C again must not start a second one
  switchingCamera = true;
  try {
    const cam = await pose.nextCamera();
    if (cam) {
      // a different picture: the play space is measured again before the next pick
      g.area = null;
      calibrated = !shouldCalibrate(params);
    }
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
let musicEnabled = musicOn(params, globalThis.localStorage); // U turns it off and on, remembered

const actions = {
  start() {
    if (state === 'setup') toMenu(); // skip the setup check
    else if (state === 'calibrate') skipCalibration();
    else if (state === 'menu') startGame();
    else if (state === 'pick') choose(carousel.index); // the game in the middle
  },
  next() {
    if (g.level && inLevel()) nextLevel();
  },
  // Back one step: from a level to the picker, from the picker to the join screen.
  menu() {
    if (state === 'setup') toMenu();
    else if (state === 'calibrate') skipCalibration();
    else if (inLevel()) toPick();
    else if (state === 'pick') toMenu();
  },
  fullscreen() {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  },
  camera() {
    if (pose && tracker === pose) switchCamera();
  },
  music() {
    musicEnabled = !musicEnabled;
    saveMusicOn(globalThis.localStorage, musicEnabled);
    toast(musicEnabled ? 'Music on' : 'Music off (sound effects stay on)', 3);
  },
  family() {
    family.toggle();
    toast(family.active ? `Family room ${family.code}: ${family.role === 'host' ? 'ask them to open ' + family.link : 'looking for the host'}` : 'Family room closed', 6);
  },
  save() {
    saveRecording();
  },
  video() {
    if (!g.debug) return;
    toast(debugRecorder().toggleVideo() ? 'Recording the screen too (kept on this computer, last 30-60 s)' : 'Screen video off', 4);
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
  else if (k === 'p' && state === 'pick' && tracker !== mouse) toCalibrate(); // measure the play space again
  else if (k >= '1' && k <= '9' && Number(k) <= LEVELS.length && state !== 'loading') {
    if (state === 'menu') g.team.score = 0;
    startLevel(Number(k) - 1);
  } else if (k === 'escape') actions.menu();
  else if (k === 'f') actions.fullscreen();
  else if (k === 'd') g.debug = !g.debug;
  else if (k === 'c') actions.camera();
  else if (k === 'o' && state !== 'loading') actions.family();
  else if (k === 'v') family.toggleMute();
  else if (k === 'u') actions.music();
  else if (k === 'b') g.view = g.view === 'cutout' ? 'camera' : 'cutout';
  else if (k === 'k') g.skeleton = { thin: 'bold', bold: 'off', off: 'thin' }[g.skeleton];
  else if (k === 'r' && g.debug) actions.save();
  else if (k === 'g' && g.debug) actions.video();
  else if (k === 'l' && (g.debug || replay)) chooseRecording();
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
  if (state === 'calibrate') return skipCalibration();
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
  debug: () => g.debug,
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
    if (q.paper !== undefined) q.paper += dt * 7; // confetti flutters down at its own pace
    else if (!q.txt && !q.ring) q.vy += 900 * g.u * dt;
  }
  g.particles = g.particles.filter((q) => q.life > 0);

  if (state === 'setup') {
    updateSetup(dt);
  } else if (state === 'calibrate') {
    const phase = calibration.phase;
    calibration.update(localPeople().filter((p) => p.present && !p.excluded), g.W, dt);
    if (calibration.phase !== phase) sfx.star(); // one side done
    if (calibration.finished) calibrationDone();
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
      } else {
        sfx.fanfare();
        g.confetti();
      }
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
      if (playing && !(replay && tracker === replay && g.now < replayAdmitUntil)) p.excluded = true; // (a replay's kids were already playing)
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
  if (state === 'menu' || state === 'pick' || state === 'loading' || state === 'setup' || state === 'calibrate' || !g.level) return 'menu';
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
    if (q.txt) {
      // pops in with a bounce, stays solid, then fades over its last 40%
      ctx.globalAlpha = Math.min(1, a / 0.4);
      text(ctx, q.txt, q.x, q.y, q.size * popScale(q.max - q.life), { color: q.color });
    } else if (q.ring) {
      ctx.lineWidth = 10 * g.u * a;
      ctx.strokeStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (1.15 - a * 0.85), 0, Math.PI * 2);
      ctx.stroke();
    } else if (q.paper !== undefined) {
      ctx.globalAlpha = Math.min(1, a * 3);
      ctx.fillStyle = q.color;
      ctx.save();
      ctx.translate(q.x + Math.sin(q.paper) * 20 * g.u, q.y);
      ctx.rotate(q.paper * 0.7);
      ctx.fillRect(-q.size / 2, -q.size * 0.3 * Math.abs(Math.cos(q.paper)) - 1, q.size, q.size * 0.6 * Math.abs(Math.cos(q.paper)) + 2);
      ctx.restore();
    } else {
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
  const left = Math.max(0, L.duration - levelT);
  const ending = left < 5 && state === 'play'; // the last 5 s: the bar goes orange and throbs
  const bh = 22 * u * (ending ? 1 + 0.15 * Math.max(0, Math.sin(g.now * 10)) : 1);
  roundRect(bx - 4 * u, 39 * u - bh / 2 - 4 * u, bw + 8 * u, bh + 8 * u, 'rgba(0,0,0,0.45)');
  if (left > 0) roundRect(bx, 39 * u - bh / 2, Math.max(bh, bw * (left / L.duration)), bh, ending ? '#ffa23d' : '#fff');
  // team score
  drawArt(ctx, 'star', g.W - 220 * u, 55 * u, 64 * u);
  text(ctx, String(g.team.score), g.W - 40 * u, 55 * u, 64 * u, { align: 'right', color: '#ffe14d' });
  if (L.hearts) {
    for (let i = 0; i < g.team.maxHearts; i++) drawHeart(ctx, g.W - (60 + i * 62) * u, 130 * u, 28 * u, i < g.team.hearts);
  }
}

function roundRect(x, y, w, h, color, r = h / 2) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
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

function skipCalibration() {
  calibration.skip();
  calibrationDone();
}

// The play-space check: a big arrow says which way to walk, and a green floor grows under the kids as they explore.
// The words stay in the top band, like every screen, so the kids can watch themselves.
function drawCalibration() {
  const u = g.u;
  const c = calibration;
  ctx.fillStyle = 'rgba(8,12,30,0.25)';
  ctx.fillRect(0, 0, g.W, g.H);
  // the ground found so far: a green strip along the bottom, from the furthest left to the furthest right
  if (c.lo <= c.hi) {
    const a = c.phase === 'done' ? c.area : null;
    const x0 = (a ? a.x0 : c.lo) * g.W;
    const x1 = (a ? a.x1 : c.hi) * g.W;
    const y = g.H - 90 * u;
    ctx.fillStyle = 'rgba(77,255,136,0.35)';
    ctx.fillRect(x0 - 40 * u, y, x1 - x0 + 80 * u, 70 * u);
    ctx.fillStyle = '#4dff88';
    ctx.fillRect(x0 - 40 * u, y, x1 - x0 + 80 * u, 8 * u);
    for (const x of [x0 - 40 * u, x1 + 40 * u]) text(ctx, '⭐', x, y + 30 * u, 60 * u);
  }
  if (c.phase === 'done') {
    text(ctx, 'This is your play space!', g.W / 2, g.H * 0.08, 84 * u, { color: '#7dff6b' });
    text(ctx, 'The games will stay inside it.', g.W / 2, g.H * 0.16, 44 * u);
    return;
  }
  const left = c.phase === 'left';
  text(ctx, 'Show me your play space!', g.W / 2, g.H * 0.07, 72 * u, { color: '#ffe14d' });
  text(ctx, left ? 'Walk this way as far as you can go!' : 'Now walk the other way, as far as you can!', g.W / 2, g.H * 0.15, 48 * u);
  // a big bouncing arrow on that side, and a ring that fills once they have stopped at the furthest spot
  const dir = left ? -1 : 1;
  const x = g.W / 2 + dir * (g.W * 0.36 + Math.sin(g.now * 6) * 25 * u);
  const y = g.H * 0.3;
  text(ctx, left ? '⬅' : '➡', x, y, 150 * u, { color: '#ffe14d' });
  if (c.progress > 0) {
    ctx.lineWidth = 14 * u;
    ctx.strokeStyle = '#7dff6b';
    ctx.beginPath();
    ctx.arc(x, y, 100 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
    ctx.stroke();
  }
  const how = settings.mobile ? 'tap the screen' : 'press SPACE or tap';
  text(ctx, `Stop where a wall or the sofa is in the way.   Grown-ups: ${how} to skip`, g.W / 2, g.H * 0.21, 28 * u, { color: '#cfd6e6' });
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
  else if (state === 'calibrate') drawCalibration();
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
    text(ctx, 'Pick a game!', g.W / 2, g.H * 0.045, 60 * u, { color: '#ffe14d' });
    drawPicker(ctx, g, choices, carousel, pickCards(), lastStep);
  } else if (state === 'intro') {
    ctx.fillStyle = 'rgba(8,12,30,0.4)';
    ctx.fillRect(0, 0, g.W, g.H);
    // the level's colour as a soft band behind the words, its picture beside the level number
    ctx.globalAlpha = 0.35;
    roundRect(g.W * 0.08, g.H * 0.15, g.W * 0.84, g.H * 0.42, g.level.color, 60 * u);
    ctx.globalAlpha = 1;
    text(ctx, `${g.level.icon ?? ''}  Level ${levelIdx + 1}`, g.W / 2, g.H * 0.22, 70 * u, { color: '#ffe14d' });
    text(ctx, g.level.title, g.W / 2, g.H * 0.36, 130 * u * popScale(stateT));
    text(ctx, g.level.hint, g.W / 2, g.H * 0.5, 50 * u);
    // 3, 2, 1: each number lands with a bounce on its own second
    const n = Math.max(1, Math.ceil(3 - stateT));
    text(ctx, String(n), g.W / 2, g.H * 0.7, 200 * u * popScale(stateT - (3 - n)), { color: '#7dff6b' });
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

  if (replay && tracker === replay) drawReplay();
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
    const lines = [...debugLines(), recordingLine(), `keys: D debug  B cut-out/camera  K skeleton  C camera  F fullscreen  M mouse  N next  P play space  1-${LEVELS.length} level  Esc menu`];
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
    `${browser}   gpu ${gpuName()}   play space ${g.area ? `${Math.round(g.area.x0 * 100)}-${Math.round(g.area.x1 * 100)}% (hands ${Math.round(g.area.reach0 * 100)}-${Math.round(g.area.reach1 * 100)}%)` : 'whole screen'}`,
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

// ------------------------------------------------------------------ recordings (debug mode, see recording.js)
// While debug is on, the last minute is kept: every tracking answer, a few samples a second of how things ran,
// and what happened. R saves it as a file to send back with a problem; G adds a video of the screen (it shows the
// kids, so only when asked). ?replay (or dropping a file on the page) plays one back through the real game.
// Nothing here runs, or costs anything, until debug is turned on.
/** @type {DebugRecorder | null} */
let rec = null;
let sampleAt = 0;
let replayAdmitUntil = 0;
let replayEnded = false;

function debugRecorder() {
  if (rec) return rec;
  rec = new DebugRecorder(canvas);
  // warnings (recovery, slow drawing) go in the recording too
  for (const level of /** @type {const} */ (['warn', 'error'])) {
    const orig = console[level];
    console[level] = (...a) => {
      note(level, { text: a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ') });
      orig.apply(console, a);
    };
  }
  note('state', { state, level: g.level?.id ?? null });
  return rec;
}

/** @param {string} type  @param {Record<string, any>} [data] */
function note(type, data) {
  if (g.debug && rec) rec.data.event(g.now, type, data);
}

const round1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;
function recordSample(now) {
  debugRecorder();
  if (pose && !pose.onAnswer) pose.onAnswer = (res, t) => g.debug && rec.data.frame(t, res.landmarks, res.looks, pose.video.videoWidth, pose.video.videoHeight);
  if (now < sampleAt) return;
  sampleAt = now + 0.25;
  const cam = pose && tracker === pose;
  rec.data.sample(now, {
    state,
    level: g.level?.id ?? null,
    levelT: round1(levelT),
    fps: Math.round(1 / dtSmooth),
    detectMs: round1(tracker?.detectMs ?? 0),
    modelMs: cam ? round1(pose.modelMs) : null,
    quality: cam ? pose.quality.name : null,
    tracking: `${tracker?.delegate}${cam ? (pose.useWorker ? ' worker' : ' main') : ''}`,
    cameraFps: cam ? round1(pose.cameraFps) : null,
    reconnecting: reconnecting(),
    diff: Math.round(g.diff * 100) / 100,
    score: g.team.score,
    hearts: g.team.hearts,
    view: g.view,
    fx: g.fx,
    cutout: g.view === 'cutout' && cutoutReady ? Math.round(cutout.stats.coverage * 100) : null,
    players: g.players.map((p) => ({ id: p.id, x: Math.round(p.cx), out: !!p.excluded, pose: Object.keys(p.pose ?? {}).filter((k) => p.pose[k]).join('+') })),
  });
}

async function saveRecording() {
  if (!g.debug) return;
  const r = debugRecorder();
  const secs = Math.round(r.data.span);
  try {
    const names = await r.save({
      saved: new Date().toISOString(),
      browser: navigator.userAgent,
      gpu: gpuName(),
      screen: [g.W, g.H],
      url: location.search,
      state,
      level: g.level?.id ?? null,
      camera: pose ? { label: pose.cameraLabel, size: [pose.video.videoWidth, pose.video.videoHeight], mode: pose.mode } : null,
      debug: debugLines(),
    });
    if (names.length) toast(`Saved the last ${secs} s: ${names.join(', ')} (in Downloads)`, 6);
  } catch (e) {
    console.warn('could not save the recording', e);
    toast(`Could not save: ${e.message || e}`, 5);
  }
}

function recordingLine() {
  if (!rec) return 'recording: starting';
  return `recording the last ${Math.round(rec.data.span)} s${rec.videoOn ? ' + screen video' : ''}   R save   G video ${rec.videoOn ? 'off' : 'on'}   L load a recording`;
}

/** @param {import('./recording.js').Recording | null} recording */
function useReplay(recording) {
  replay = new ReplayTracker(recording ?? { kind: '', version: 1, meta: {}, frames: [], samples: [], events: [] });
  tracker = replay;
  g.players = [];
  replayEnded = false;
  resize();
}

// Play a recording: back to where the game was when it starts (the level and how far in), then the kids'
// movements arrive as they did.
/** @param {import('./recording.js').Recording} recording */
function loadRecording(recording) {
  useReplay(recording);
  g.notice = '';
  const start = recordingStart(recording);
  const i = LEVELS.findIndex((l) => l.id === start.level);
  replayAdmitUntil = g.now + 2;
  if (i >= 0 && (start.state === 'intro' || start.state === 'play' || start.state === 'outro')) {
    startLevel(i);
    if (start.state !== 'intro') {
      setState('play');
      levelT = start.levelT;
    }
  } else if (start.state === 'pick') toPick();
  else toMenu();
  toast(`Replaying ${recording.frames.length ? Math.round(recording.frames.at(-1).t - recording.frames[0].t) : 0} s${start.level ? ` from ${start.level}` : ''}`, 3);
}

function chooseRecording() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => input.files[0] && openRecordingFile(input.files[0]);
  input.click();
}

/** @param {File} file */
async function openRecordingFile(file) {
  try {
    loadRecording(parseRecording(await file.text()));
  } catch (e) {
    toast(e.message || String(e), 5);
  }
}

window.addEventListener('dragover', (e) => (g.debug || replay) && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!(g.debug || replay)) return;
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) openRecordingFile(file);
});

function drawReplay() {
  const u = g.u;
  if (replay.done && replay.rec.frames.length && !replayEnded) {
    replayEnded = true;
    toast('Replay finished. Press L to load another', 5);
  }
  const what = replay.rec.frames.length ? `Replay ${Math.round(replay.progress * 100)}%` : 'Replay: no recording loaded';
  text(ctx, what, 30 * u, g.H - 70 * u, 30 * u, { align: 'left', color: '#ffe14d' });
}

// The music follows the screen (music.js moodFor). On a family call it goes quieter, and further down while
// anyone talks: the host hears the guests' voices over it, and its own microphone ducks the copy the guests hear.
// A guest hears the host's music in the host's sounds, so it plays none of its own.
function playMusic() {
  const mood = musicEnabled && !family.guestView ? moodFor(state, g.level?.id) : null;
  const host = family.role === 'host';
  music.update(mood, {
    family: family.state === 'connected',
    incoming: host ? family.audios.map((a) => /** @type {MediaStream} */ (a.srcObject)) : [],
    outgoing: host ? family.mic : null,
  });
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
  if (g.debug) recordSample(now);
  playMusic();
  render();
}

requestAnimationFrame(frame);
boot();

// handy for debugging / automated tests
/** @type {any} */ (window).__game = { g, levels: LEVELS, startLevel, cutout, backdrops, get state() { return state; }, get tracker() { return tracker; }, get cutoutReady() { return cutoutReady; }, get carousel() { return carousel; }, get setup() { return setup; }, get calibration() { return calibration; }, pickCards, family, get recorder() { return rec; }, get replay() { return replay; }, loadRecording, music };
