// Camera choices, kept free of any camera or DOM so they can be unit tested.
//
//  - Which picture size to ask for. 'wide' (1280x720, 16:9) uses a webcam's full field of view; many
//    webcams crop the sides when asked for 640x480, so 'wide' lets more of the room into the picture.
//    It costs very little: the pose model's time barely changes with resolution.
//  - Falling back to 'standard' (640x480) if a cheap webcam can't deliver a smooth frame rate at 720p.
//  - Cycling between cameras (a phone used as a webcam shows up as an extra camera) and remembering the pick.

export const MODES = {
  wide: { width: 1280, height: 720 },
  standard: { width: 640, height: 480 },
};

export const parseMode = (v) => (v === 'wide' || v === 'standard' ? v : null);

// Constraints for getUserMedia. Sizes and frame rate are "ideal" (a wish, not a demand) so a camera that
// can't do 720p still works. A specific camera is requested with `exact` so we never silently get another.
export function cameraConstraints({ deviceId = null, mode = 'wide' } = {}) {
  const size = MODES[mode] ?? MODES.wide;
  return {
    video: {
      width: { ideal: size.width },
      height: { ideal: size.height },
      frameRate: { ideal: 30 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
    },
    audio: false,
  };
}

const videoInputs = (devices) => devices.filter((d) => d.kind === 'videoinput' && d.deviceId);

// The camera to switch to after `currentId` (wrapping round), or null if there is nothing to switch to.
export function nextCameraId(devices, currentId) {
  const cams = videoInputs(devices);
  if (cams.length < 2) return null;
  const i = cams.findIndex((d) => d.deviceId === currentId);
  return cams[(i + 1) % cams.length].deviceId; // unknown current camera (i = -1) -> the first one
}

// "Camera 2 of 3: Pixel 8 (Iriun)" style information for the on-screen message.
// If the camera in use is missing from the list (some systems hide it), it is counted as one more camera.
export function describeCamera(devices, id, fallbackLabel = '') {
  const cams = videoInputs(devices);
  const i = cams.findIndex((d) => d.deviceId === id);
  if (i < 0) return { index: cams.length + 1, count: cams.length + 1, label: fallbackLabel || `Camera ${cams.length + 1}` };
  return { index: i + 1, count: cams.length, label: cams[i].label || `Camera ${i + 1}` };
}

// Remember which camera the grown-up chose (so a phone webcam app doesn't need re-selecting each time).
export const CAMERA_KEY = 'kcg.camera';
export function loadSavedCamera(storage) {
  try {
    return storage?.getItem(CAMERA_KEY) || null;
  } catch {
    return null; // storage blocked (private mode etc.)
  }
}
export function saveCamera(storage, id) {
  try {
    if (id) storage.setItem(CAMERA_KEY, id);
    else storage.removeItem(CAMERA_KEY);
  } catch {
    /* not worth failing over */
  }
}

// Watches how fast the camera really delivers frames. Feed it the time of every new frame (seconds).
// It ignores the first second (cameras start slowly), then measures for a few seconds and gives a verdict.
export class FpsGuard {
  constructor({ minFps = 15, warmup = 1, window = 3 } = {}) {
    this.minFps = minFps;
    this.warmup = warmup;
    this.window = window;
    this.first = null;
    this.start = null;
    this.count = 0;
    this.span = 0;
  }

  frame(t) {
    if (this.first === null) {
      this.first = t;
      return;
    }
    if (t - this.first < this.warmup) return;
    if (this.start === null) {
      this.start = t;
      return;
    }
    this.count++;
    this.span = t - this.start;
  }

  // Same idea, but from a running count of frames the camera has delivered (video.requestVideoFrameCallback's
  // presentedFrames), so the measurement does not depend on how often a busy page gets to look.
  sample(t, totalFrames) {
    if (this.first === null) {
      this.first = t;
      return;
    }
    if (t - this.first < this.warmup) return;
    if (this.start === null) {
      this.start = t;
      this.startFrames = totalFrames;
      return;
    }
    this.count = totalFrames - this.startFrames;
    this.span = t - this.start;
  }

  get fps() {
    return this.span > 0 ? this.count / this.span : 0;
  }

  // 'pending' until enough frames have been seen, then 'ok' or 'slow'
  verdict() {
    if (this.start === null || this.span < this.window) return 'pending';
    return this.fps < this.minFps ? 'slow' : 'ok';
  }
}

// Cameras are slow to let go: straight after one is released the browser can briefly say "not found" or "in use"
// (or list no cameras at all), especially with phone webcam apps. Those errors are worth a short retry.
export const isTransientCameraError = (e) => ['NotFoundError', 'NotReadableError', 'AbortError'].includes(e?.name);

export async function withRetry(fn, { tries = 4, delayMs = 250, retryIf = isTransientCameraError, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn(i);
    } catch (e) {
      if (!retryIf(e) || i >= tries - 1) throw e;
      await sleep(delayMs);
    }
  }
}
