// On-screen buttons for the grown-up, for phones and tablets (no keyboard) and for anyone who prefers to tap.
// They stay out of the way: hidden while the kids play, shown for a few seconds when someone touches the
// screen (or moves a mouse, when the mouse isn't playing), with the same actions as the keys.
// Also keeps the screen awake: nobody touches a propped-up phone during a game, so it would otherwise dim and lock.

const HIDE_AFTER = 5; // seconds without a touch before the buttons fade away

/**
 * @typedef {object} Actions
 * @property {() => void} start       start with everyone (join screen), or a surprise level (level picker)
 * @property {() => void} next        next level
 * @property {() => void} menu        back one step: level -> level picker -> join screen
 * @property {() => void} fullscreen
 * @property {() => void} camera      switch camera
 * @property {() => void} family      open or close a family room (play with another home)
 * @property {() => void} save        debug mode: save the last minute as a recording (recording.js)
 * @property {() => void} video       debug mode: turn the screen video on or off for recordings
 */

/**
 * @param {Actions} actions
 * @param {{ mouseIsPlaying: () => boolean, state: () => string, hasCamera: () => boolean, family?: () => boolean, debug?: () => boolean }} info
 */
export function createControls(actions, info) {
  const bar = document.createElement('div');
  bar.id = 'controls';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Game controls');
  /** @type {Record<string, HTMLButtonElement>} */
  const buttons = {};
  for (const [key, label] of [['start', '▶ Start'], ['next', '⏭ Next level'], ['menu', '⏏ Menu'], ['camera', '📷 Camera'], ['family', '👪 Family'], ['fullscreen', '⛶ Full screen'], ['save', '💾 Save last minute'], ['video', '🎥 Video']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.action = key;
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      actions[key]();
      show();
    });
    buttons[key] = b;
    bar.append(b);
  }
  document.body.append(bar);

  let hideAt = 0;
  const now = () => performance.now() / 1000;
  function show() {
    hideAt = now() + HIDE_AFTER;
    refresh();
    bar.classList.add('shown');
  }
  function refresh() {
    const s = info.state();
    buttons.start.hidden = !(s === 'menu' || s === 'pick' || s === 'calibrate'); // in the play-space check it skips
    buttons.next.hidden = s === 'menu' || s === 'pick' || s === 'loading' || s === 'setup' || s === 'calibrate';
    buttons.menu.hidden = s === 'menu' || s === 'loading';
    buttons.camera.hidden = !info.hasCamera();
    buttons.family.hidden = !(s === 'menu' || info.family?.());
    buttons.fullscreen.hidden = !document.documentElement.requestFullscreen;
    buttons.save.hidden = buttons.video.hidden = !info.debug?.() || s === 'loading';
  }
  window.addEventListener('pointerdown', show);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !info.mouseIsPlaying()) show();
  });
  setInterval(() => {
    if (bar.classList.contains('shown') && now() > hideAt) bar.classList.remove('shown');
    else if (bar.classList.contains('shown')) refresh();
  }, 250);

  const nudge = fullscreenNudge(actions, info);
  keepAwake();
  return { show, element: bar, nudge };
}

// Is the game filling the screen? Either the Fullscreen API is on, or the browser itself is full screen
// (F11, a kiosk, or the game installed as an app on the home screen).
export function isFullscreen() {
  if (document.fullscreenElement) return true;
  const mq = (q) => window.matchMedia?.(q).matches;
  return !!(mq('(display-mode: fullscreen)') || mq('(display-mode: standalone)') || /** @type {any} */ (navigator).standalone);
}

// A small note in the menu when the game is not full screen, with a button that fixes it. Browsers only allow
// full screen from a tap or click, so it can't just switch by itself. On iPhone, where web pages can't go
// full screen, it suggests adding the game to the home screen instead. The x hides it until the next visit.
function fullscreenNudge(actions, info) {
  const box = document.createElement('div');
  box.id = 'fullscreen-nudge';
  box.setAttribute('role', 'status');
  const canFullscreen = !!document.documentElement.requestFullscreen;
  const msg = document.createElement('span');
  msg.textContent = canFullscreen ? 'Full screen works best on a TV.' : 'For full screen: Share, then Add to Home Screen.';
  box.append(msg);
  if (canFullscreen) {
    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.action = 'fullscreen';
    go.textContent = '⛶ Full screen';
    go.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.fullscreen();
    });
    box.append(go);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Hide this note');
  close.textContent = '✕';
  let dismissed = false;
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissed = true;
    refresh();
  });
  box.append(close);
  document.body.append(box);

  function refresh() {
    const s = info.state();
    box.hidden = dismissed || isFullscreen() || !(s === 'menu' || s === 'pick');
  }
  document.addEventListener('fullscreenchange', refresh);
  window.addEventListener('resize', refresh);
  setInterval(refresh, 500);
  refresh();
  return box;
}

// Screen Wake Lock: ask now, ask again after every touch until it is granted, and again when the page comes
// back into view (the browser releases it when the tab is hidden). Unsupported browsers just carry on.
function keepAwake() {
  let lock = null;
  const ask = async () => {
    if (lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } catch {
      /* needs a user gesture on some browsers: the next touch tries again */
    }
  };
  ask();
  window.addEventListener('pointerdown', ask);
  window.addEventListener('keydown', ask);
  document.addEventListener('visibilitychange', ask);
}
