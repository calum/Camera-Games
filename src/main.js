/** @import { Game, Player } from './types.js' */
import { PoseTracker, MouseTracker } from './tracker.js';
import { LEVELS } from './levels/index.js';
import { sfx, unlock, music } from './audio.js';
import { moodFor, musicOn, saveMusicOn } from './music.js';
import { Ease } from './ease.js';
import { loadArt, registerArt } from './art.js';
import { text, drawSkeleton, drawPoseIcon } from './draw.js';
import { Lobby, lateJoin } from './lobby.js';
import { Carousel, pickerChoices, setChoices, carouselLayout, carouselCardAt, surprisePick } from './picker.js';
import { SETS, setPlaylist } from './levels/sets.js';
import { drawParticles, drawHud, drawSetup, drawCalibration, drawReconnecting, drawLoading, drawMenu, drawPick, drawIntro, drawOutro, drawToast, drawDebugPanel } from './screens.js';
import { Cutout } from './cutout.js';
import { syncForts, applyFort, fortOf } from './forts.js';
import { Backdrops } from './backdrops.js';
import { loadSavedCamera } from './camera.js';
import { defaultSettings } from './device.js';
import { createControls } from './controls.js';
import { Family } from './family.js';
import { SIGNAL_URL } from './online-config.js';
import { DebugSession } from './debug-record.js';
import { recordingStart } from './recording.js';
import { ReplayTracker } from './replay.js';
import { Calibration, shouldCalibrate } from './calibrate.js';
import { SetupCheck, shouldRunSetup, saveSetupDone, frameBrightness, judgeCamera, judgeLight, judgeDistance, judgeSpeed, judgeGraphics, softwareRendering } from './setup-check.js';

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
// The picker has two sets of cards: the game sets it opens on, and one card per level ("Pick your game").
const levelChoices = pickerChoices(LEVELS);
const levelCarousel = new Carousel({ n: levelChoices.length });
const allSets = setChoices(SETS);
const setCarousel = new Carousel({ n: allSets.length });
/** @type {'sets' | 'levels'} */
let pickMode = 'sets';
const choices = () => (pickMode === 'sets' ? allSets : levelChoices);
const carousel = () => (pickMode === 'sets' ? setCarousel : levelCarousel);
/** @type {import('./levels/sets.js').Playlist | null} */
let playlist = null; // the game set being played, if any
let lastSet = -1; // the set card played last, back in the middle afterwards
let lastStep = -9; // when the carousel last scrolled (the middle card bounces)
// The cards as drawn this frame (for taps, and for the tests)
const pickCards = () => carouselLayout(choices().length, carousel().pos, g.W, g.H);
// Playing with family in another home (docs/ONLINE.md). Idle unless the grown-up opens a room (key O) or the page
// was opened with ?room=CODE.
const family = new Family({ canvas, search: location.search, origin: location.origin + location.pathname, signal: params.get('signal') || SIGNAL_URL });
let outroMsg = '';
let status = 'Loading...';
let setup = new SetupCheck();
// The play space (calibrate.js): measured every time a group joins from the menu, before their first picker, and
// again after a camera switch (a new picture, a new space) or when a grown-up presses P in the picker. A new group
// can stand somewhere else or reach further, so they get a space that fits them; skipping keeps the last one.
// ?nocal and ?level= skip it.
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

// The picker: the kids who joined choose what to play, and come back here after every level they picked, or
// after a whole game set. mode: the set cards or the level cards.
function toPick(mode = pickMode) {
  pickMode = mode;
  playlist = null;
  if (!calibrated && tracker !== mouse) return toCalibrate(); // a mouse has no room to measure
  g.level = null;
  // the game (or set) just played is in the middle: "again!" is arms up
  if (mode === 'sets') setCarousel.reset(lastSet >= 0 ? lastSet : 0);
  else levelCarousel.reset(lastPlayed >= 0 ? lastPlayed : 0);
  setState('pick');
}
// Back to the picker from a level: to the sets after a set, else to the cards it was picked from.
const backToPick = () => toPick(playlist ? 'sets' : pickMode);

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

/** @param {number} i  a card in `choices()` */
function choose(i) {
  const c = choices()[i];
  if (!c) return;
  sfx.chime();
  if (c.kind === 'all') return toPick('levels');
  if (c.kind === 'back') return toPick('sets');
  if (c.kind === 'set') {
    lastSet = i;
    playlist = { set: c.set, order: setPlaylist(c.set, LEVELS, lastPlayed), at: 0 };
    return startLevel(playlist.order[0]);
  }
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
  g.fortLayout?.reset(); // fort games: everyone gets a fresh fort, placed by where they stand now
  g.forts = undefined;
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
  calibrated = !shouldCalibrate(params); // a new group shows the game their own play space
  lastSet = -1;
  toPick('sets');
}

// The next game of the set being played, or null at its end (or with no set).
const nextInSet = () => (playlist && playlist.at + 1 < playlist.order.length ? LEVELS[playlist.order[playlist.at + 1]] : null);

// After a level (or the grown-up's "skip"): the set's next game, the end of the set, or out of a set the next level in
// the list (wrapping round) for a skip and the picker otherwise.
function afterLevel(skip = false) {
  if (nextInSet()) {
    playlist.at++;
    startLevel(playlist.order[playlist.at]);
  } else if (playlist || !skip) backToPick();
  else startLevel(levelIdx + 1);
}
const nextLevel = () => afterLevel(true);

const inLevel = () => state === 'intro' || state === 'play' || state === 'outro';
// A fort game is on (src/forts.js): every player is drawn in their own fort instead of where they stand.
const fortsOn = () => !!(g.level?.forts && inLevel() && g.forts);
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
  playlist = null;
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
    else if (state === 'pick') choose(carousel().index); // the card in the middle
  },
  next() {
    if (g.level && inLevel()) nextLevel();
  },
  // Back one step: from a level to the picker, from the level cards to the sets, from the sets to the join screen.
  menu() {
    if (state === 'setup') toMenu();
    else if (state === 'calibrate') skipCalibration();
    else if (inLevel()) backToPick();
    else if (state === 'pick' && pickMode === 'levels') toPick('sets');
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
    debug.save();
  },
  video() {
    if (!g.debug) return;
    toast(debug.recorder().toggleVideo() ? 'Recording the screen too (kept on this computer, last 30-60 s)' : 'Screen video off', 4);
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
    playlist = null;
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
  else if (k === 'l' && (g.debug || replay)) debug.choose();
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
  if (card.i === carousel().index) choose(card.i);
  else scroll(Math.sign(card.off) * Math.max(1, Math.round(Math.abs(card.off))));
});

function scroll(d) {
  carousel().step(d);
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
  if (g.level?.forts && inLevel()) syncForts(g);

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
    const { step, chosen } = carousel().update(g.activePlayers(), dt);
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
    if (stateT > 4) afterLevel(); // the set's next game, or back to the picker (the same level is one card away)
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
  if (fortsOn()) {
    // Fort games: each kid's slice of the picture goes into their own fort. Guests come from their own picture.
    for (const f of /** @type {import('./forts.js').Fort[]} */ (g.forts)) {
      if (!f.p || (!f.p.remote && !(camera && cutoutReady))) continue;
      ctx.save();
      applyFort(ctx, f, g.H);
      if (f.p.remote) family.drawGuest(ctx, g.W, g.H);
      else cutout.draw(ctx, /** @type {any} */ (r));
      ctx.restore();
    }
    // Someone watching (not playing yet) has no fort: they show faintly where they really stand, so they can see
    // themselves and join with arms out (lateJoin), and then they get a fort of their own.
    if (camera && cutoutReady) {
      for (const p of g.players) {
        if (!p.present || !p.excluded || p.remote) continue;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.rect(p.cx - p.shoulderW * 2, 0, p.shoulderW * 4, g.H);
        ctx.clip();
        cutout.draw(ctx, /** @type {any} */ (r));
        ctx.restore();
      }
    }
    return;
  }
  if (camera && cutoutReady) cutout.draw(ctx, r);
  family.drawGuest(ctx, g.W, g.H);
}

// The skeletons over the kids: in a fort game, each in its fort (a watcher has no fort and stays where they are).
function drawSkeletons() {
  for (const p of g.players) {
    const f = fortsOn() ? fortOf(/** @type {import('./forts.js').Fort[]} */ (g.forts), p) : null;
    if (!f) {
      drawSkeleton(ctx, p, g);
      if (fortsOn() && p.present && p.excluded) {
        drawPoseIcon(ctx, 'airplane', p.cx, p.px[0].y - 150 * g.u, 70 * g.u);
        text(ctx, 'Arms out to join!', p.cx, p.px[0].y - 60 * g.u, 36 * g.u);
      }
      continue;
    }
    ctx.save();
    applyFort(ctx, f, g.H);
    drawSkeleton(ctx, p, g);
    ctx.restore();
  }
}

function skipCalibration() {
  calibration.skip();
  calibrationDone();
}

function render() {
  const u = g.u;
  if (family.guestView && family.drawHostPicture(ctx, g.W, g.H)) return; // the host's picture already carries the room label
  drawBackground();

  if (state === 'loading') return drawLoading(ctx, g, status);

  if (g.level && inLevel()) g.level.draw(g, ctx);
  drawSkeletons();
  drawParticles(ctx, g);

  if (state === 'setup') drawSetup(ctx, g, setup, settings.mobile);
  else if (state === 'calibrate') drawCalibration(ctx, g, calibration, settings.mobile);
  else if (state === 'menu') {
    const camera = pose && tracker === pose;
    drawMenu(ctx, g, {
      lobby,
      mobile: settings.mobile,
      portrait: camera && pose.isPortrait,
      slowGraphics: camera && softwareRendering(gpuName(), pose.delegate),
      mouseMode: tracker === mouse,
    });
  } else if (state === 'pick') {
    drawPick(ctx, g, pickMode === 'sets' ? 'What shall we play?' : 'Pick a game!', LEVELS, choices(), carousel(), pickCards(), lastStep);
  } else if (state === 'intro') {
    drawIntro(ctx, g, levelIdx, stateT, playlist);
  } else if (state === 'play') {
    drawHud(ctx, g, levelT, true);
  } else if (state === 'outro') {
    drawHud(ctx, g, levelT, false);
    drawOutro(ctx, g, outroMsg, nextInSet());
  }

  if (replay && tracker === replay) debug.drawReplay(ctx, replay);
  if (reconnecting()) drawReconnecting(ctx, g, reconnecting(), g.now - pose.reconnectingSince);
  if (family.active) text(ctx, family.label, 30 * u, g.H - 30 * u, 26 * u, { align: 'left' });

  drawToast(ctx, g);

  if (g.debug) {
    const lines = [...debugLines(), debug.line, `keys: D debug  B cut-out/camera  K skeleton  C camera  F fullscreen  M mouse  N next  P play space  1-${LEVELS.length} level  Esc menu`];
    drawDebugPanel(ctx, g, lines);
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
  if (g.debug) console.log(`[camera-games debug] ${debugLines().join(' | ')}`);
}

// ------------------------------------------------------------------ recordings (debug mode, see debug-record.js)
// Keeping and saving the last minute (R), screen video (G) and choosing a recording (L or a dropped file) live in
// DebugSession. Playing a recording drives the state machine, so that part stays here.
let replayAdmitUntil = 0;
const debug = new DebugSession({
  canvas,
  g,
  view: () => ({
    state,
    levelT,
    fps: Math.round(1 / dtSmooth),
    tracker,
    pose,
    camera: !!pose && tracker === pose,
    reconnecting: reconnecting(),
    cutout: g.view === 'cutout' && cutoutReady ? Math.round(cutout.stats.coverage * 100) : null,
    gpu: gpuName(),
    get lines() {
      return debugLines(); // only built when a file is saved
    },
    replaying: !!replay,
  }),
  toast,
  play: loadRecording,
});
const note = debug.note;

/** @param {import('./recording.js').Recording | null} recording */
function useReplay(recording) {
  if (pose) {
    // a recording loaded in the middle of a live game (L): the camera and the pose model aren't needed any more
    pose.stop();
    pose = null;
  }
  replay = new ReplayTracker(recording ?? { kind: '', version: 1, meta: {}, frames: [], samples: [], events: [] });
  tracker = replay;
  g.players = [];
  debug.replayEnded = false;
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
  playlist = null;
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
  if (g.debug) debug.sample(now);
  playMusic();
  render();
}

requestAnimationFrame(frame);
boot();

// handy for debugging / automated tests
/** @type {any} */ (window).__game = { g, levels: LEVELS, startLevel, cutout, backdrops, get state() { return state; }, get tracker() { return tracker; }, get cutoutReady() { return cutoutReady; }, get carousel() { return carousel(); }, get pickMode() { return pickMode; }, get playlist() { return playlist; }, get setup() { return setup; }, get calibration() { return calibration; }, pickCards, family, get recorder() { return debug.rec; }, get replay() { return replay; }, loadRecording, music };
