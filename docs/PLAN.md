# Kids Camera Game: Plan

A "Nex Playground"-style game for our own kids: a webcam on the TV tracks their bodies,
and they play short levels (pop, dodge, jump, dance) using **our own art**.

## Related plans

Each plan has one job; follow the link rather than looking for the detail here.

- **This document:** the game's technical plan, architecture, design decisions and roadmap.
- [PLAYGROUND-PLAN.md](PLAYGROUND-PLAN.md): camera-confirm step and "Paint your playground" (calibrating and
  cropping to the play area).
- [PUBLIC-PLAN.md](PUBLIC-PLAN.md): release plan: phone or webcam setup guides, toddlers, accessibility, safety,
  distribution.

## Goals

1. Works on what we already own: a laptop plus a basic webcam on the TV. Phones, iPads
   and a Raspberry Pi come later.
2. Group play: 2-4 kids at once, shared goals and a bit of friendly scoring.
3. Fast to change. New levels and art should take minutes, not days.
4. No install and no cloud. It runs offline after the first setup.

## Key decision: web first, Rust later (if ever)

Reviewed again in October 2026 with phones, tablets and GitHub Pages in mind: still plain JavaScript. The pose
model is already WebAssembly + WebGL, so Rust would not speed up the expensive part, and a build step would
slow down making levels. JSDoc types checked by `tsc` (`npm run typecheck`) give most of TypeScript's safety
with no build. No backend: inference on the device is faster, free and private, so the game is a static site.


The expensive part is body tracking (a neural network), not the game. MediaPipe's pose
model runs in the browser through WASM/WebGL whatever language the game is written in.
So the game is plain JavaScript on a canvas: no build step, and it runs on every
device we own.

The game never touches raw ML output. `src/tracker.js` turns skeletons into a **player**
object (hands, body circles, jump, poses). Levels only read that object. If we later
want a Rust/Bevy build for a Pi "console", the tracker and the levels can be ported
separately and the game design carries over unchanged.

## Architecture

```
index.html -> src/main.js        game loop, state machine, HUD, screens
                 |-- tracker.js  PoseTracker (camera + MediaPipe) / MouseTracker (testing)
                 |-- levels.js   bubbles, dodge, jump, dance (each: start/update/draw)
                 |-- draw.js     text, skeleton, hearts, pose icon
                 |-- art.js      loads /assets/*.png, falls back to emoji/procedural
                 `-- audio.js    synthesized sound effects (no audio files)
server.mjs                       tiny static server (localhost:8137)
vendor/, models/                 MediaPipe runtime + pose model, stored locally
```

Flow: `loading -> menu -> intro -> play -> outro -> ... -> finale -> (harder round)`.

### How tracking becomes gameplay

| Game idea | Signal | How it's computed |
|---|---|---|
| Pop / touch | `player.hands[]` | wrists + index fingertips in screen space |
| Dodge | `player.circles[]` | head, chest, belly, hips, knees as circles |
| Jump | `player.lastJump` | hips rise above a slowly adapting baseline (relative to torso length) |
| Dance | `player.pose.*` | rule-based poses: arms up, airplane, hands on head |
| Who is who | `player.id/color` | nearest-neighbour matching keeps each kid's colour |

Everything is relative to the kid's own body size (shoulder width, torso length), so
small and tall kids, near or far, behave the same way.

## The four demo levels (30 s each)

1. **Pop the bubbles.** Hands pop bubbles, and gold ones are worth 3. Spawn rate scales with player count.
2. **Dodge the rocks.** A "!" warning, then a rock drops. Half the rocks are aimed at a kid. Rocks fall at 420-560 px/s (1080p), slowed after the first playtest. The team shares 5 hearts, and 0 hearts means the level replays.
3. **Jump the waves.** 3-2-1 countdown, then a wave rolls across the screen. Jump as it passes you. The window is deliberately forgiving (0.5 s early to 0.3 s late). Every kid gets an obvious result: a green glowing skeleton, "NICE JUMP! +1" and a ring for a good jump, or a red skeleton with "SPLASH!" / "TOO EARLY!" and a hint for a miss.
4. **Dance party.** Copy the stick-figure pose and hold it for about 1 s. Each kid scores separately.

After level 4 there is a finale screen, then the next round starts a little harder (`g.diff`).

Design rules: team-first (shared hearts and score, per-kid stars on top); forgiving
hit boxes; no hard failure (running out of hearts only replays the level); big text
readable from the sofa.

## Using our own art

Drop PNGs in `assets/` named `bubble.png`, `goldbubble.png`, `rock.png`, `star.png`,
`heart.png` or `hand.png`. They replace the built-in graphics automatically, with no
code changes. See `assets/README.md`. New art types are one line in `src/art.js`.

## Hardware notes

* **Camera:** put the webcam on top of the TV. Kids should stand 2-3 m back with their
  whole body in view. Light the room from the front and avoid bright windows behind them.
* **Laptop:** the lite pose model needs roughly 15-30 ms per frame on integrated graphics.
  That is comfortable at 30 fps.
* **Raspberry Pi 5:** expect about 15-25 fps tracking. Use `?lite` to drop glow effects.
  The game keeps drawing at 60 fps between tracking updates. A Pi 4 is borderline.
* **Phone / iPad:** open https://calum.github.io/kids-camera-games/ (HTTPS, so the camera is allowed).
  Phones and tablets start on the lite model without glow effects, tracking runs in a worker so drawing
  stays smooth, the screen is kept awake, and tapping shows the grown-up buttons.

## Roadmap

- [x] **M1: playable demo** (this repo): 4 levels, multi-kid, mouse fallback, offline.
- [ ] **M2: playtest with the kids.** Tune hit sizes, jump sensitivity, level length, spawn rates.
      The constants are at the top of each level file in `src/levels/` and in `computeFeatures` in `tracker.js`.
      Findings so far (October 2026): favourites are Dodge the rocks, then Jump the waves, then Pop the bubbles;
      Dance party (holding still poses) is the least liked. The dog was sometimes detected as a player and a
      parent walking past joined for a few seconds: fixed by probation, mid-game watching and recognising
      returning kids (`src/people.js`).
- [ ] **M3: our art and sound.** Replace the placeholder graphics, add music and voice cheers.
- [ ] **M4: more levels.** Adding one is a single file: see [ADDING-GAMES.md](ADDING-GAMES.md).
      The kids like whole-body action (dodging, jumping) far more than holding poses, so favour:
      duck-and-jump obstacle run (low branches to duck, logs to jump), meteor shower with lanes (run left and
      right), jump-to-stomp (bricks, puddles), catch falling stars in a basket (both hands), kick the ball,
      whack-a-mole with the feet, freeze dance (move, then freeze when the music stops), sleeping-dragon sneak.
      A mixed "dodge and jump" level could combine the two favourites. Rework Dance party to be more active
      (poses to the beat, shorter holds) or drop it from the default list.
- [x] **M5a: cut-out + cartoon worlds** (pose silhouette + motion safety net, a backdrop per level).
- [ ] **M5b: silhouette-only gameplay** (use the silhouette itself, not just the skeleton) for big groups and for kids who are too close
      or too small for skeleton tracking.
- [ ] **M6: Raspberry Pi kiosk.** Chromium in kiosk mode on boot, or a native Rust port if the browser is too slow.
- [x] **M7a: phone as a webcam.** Camera picker (C), remembered choice, 16:9 full-field-of-view request, slow-camera fallback, portrait warning. Works with any phone-as-webcam app that appears as a camera.
- [x] **M7b: the game running on a phone or tablet.** GitHub Pages hosting (HTTPS), relative paths, offline
      copy and install-as-app, touch buttons, wake lock, full-screen note, lighter defaults, tracking in a worker.
      Streaming a phone's camera to a laptop's browser is not planned (it would need a signalling server).
- [ ] **M7c: family play across homes.** Prototype done (two windows, room code, WebRTC); the cloud pairing step and real-network tests remain. See [ONLINE.md](ONLINE.md).
- [ ] **M8: camera setup and "Paint your playground".** See [PLAYGROUND-PLAN.md](PLAYGROUND-PLAN.md).
- [ ] **M9: public release.** See [PUBLIC-PLAN.md](PUBLIC-PLAN.md).

## Cut-out and cartoon worlds

Request: show only the kids, in a cartoon world that matches each level, and don't let a kid vanish when pose tracking glitches.

* **Which source?** Compared on an adult and a toddler photo: the pose model's own silhouette was by far the best (even a toddler's fingers); the selfie model was rougher and DeepLab poor. Reading the mask costs ~6-9 ms/frame, and it comes from the same inference as the skeleton.
* **The catch:** the pose silhouette disappears whenever pose tracking does. So `src/person-mask.js` (pure maths, fully unit-tested) fuses it with a **motion** signal (background subtraction against the empty room), which only counts near where a person was recently seen, and keeps a per-pixel confidence that **fades** (about 0.25 s while the pose model is tracking, 0.9 s when it is lost) instead of switching off. Motion alone keeps a moving kid on screen indefinitely.
* **Safeguards:** motion held up for over 5 s with no pose support is absorbed into the background (a moved cushion can't haunt the screen); a big global change (lights, camera bump) is ignored; webcam auto-exposure is compensated.
* **Rendering:** `src/cutout.js` composites the camera frame with the mask as alpha; `src/backdrops.js` draws one animated cartoon scene per level (static layer cached). Drop `assets/bg_<name>.png` to use your own art. B toggles the plain camera picture. Debug (D) shows coverage and whether the pose mask is ON or LOST.
* **Cost:** ~3 ms/frame for the fusion and compositing, backdrops negligible (measured in a software-rendered test browser).

## Cameras and field of view

* A wider field of view matters more than which camera is used. Phones have ultra-wide lenses (often ~120 degrees) vs ~60-80 for a basic webcam; many webcams also crop the sides at 640x480.
* Measured (software-rendered test browser, so only the ratios matter): pose model + silhouette readback took ~34 ms at 640x480, ~37 ms at 1280x720, ~44 ms at 1920x1080. So the game asks for 1280x720 by default.
* Cheap webcams can fall to ~10 fps at 720p, which feels broken. `FpsGuard` measures the real delivery rate (`presentedFrames`) for a few seconds and drops to 640x480 if it is under ~15 fps.
* Latency budget for a phone webcam app: USB adds roughly 50-100 ms, Wi-Fi roughly 100-300 ms (estimates, not measured here). The levels' timing windows are forgiving (jump window 0.5 s early to 0.3 s late).
* A custom phone-to-laptop stream was rejected: browsers need HTTPS for a phone camera, so it means certificates on the home network and still adds delay.

## Making it work for small kids

First playtest finding: an adult's poses registered fine but a young child's didn't, and her skeleton glitched.

* Pose rules are measured in shoulder-widths, not torso length. Torso comes from the hips, which are the least reliable joints on small kids, and kids have bigger heads and shorter arms. Regression test: `test/unit/kids.test.js` uses the real numbers from a toddler with both arms up (the old rules said "no pose").
* Poses use hysteresis, so a glitchy frame can't switch a pose on or off.
* Skeleton is smoothed with a One Euro filter (calm when still, quick when moving), joints the model is unsure about hold their last position, and a kid stays in the game through ~0.6 s tracking dropouts.
* Starts on the `full` model and auto-drops to `lite` on a slow machine; confidence thresholds are lowered to 0.35 so kids aren't dropped for a few frames.
* The camera picture is shown at full brightness and the skeleton is a thin line (K: bold/off) so kids can see themselves.
* Next ideas if it's still not good enough: silhouette-only gameplay (M5b), a heavier model with a GPU/accelerator, or calibrating per-kid arm length in the lobby.

## Who is who (October 2026)

Playtest: the dog was sometimes detected as a player, and a parent walking past was added to the game for a few
seconds. `src/people.js` (pure, unit-tested) now sits between the pose model and the game:

* **Probation:** a new body must be tracked for ~0.45 s and 3 tracked frames, and look upright (head above the
  shoulders, hips below them, measured in shoulder widths), before it becomes a player.
* **Watching mid-game:** someone who appears during a game only watches until they hold their arms out for 2 s.
* **Coming back:** a lost player is remembered for 20 s and recognised by where they went or by their look
  (mean colour of top and legs, `src/look.js`); a clearly different look is a different person.
* **Slow devices:** probation and dropout windows stretch to cover 2.5 tracked frames.

## Known limits

* Skeleton tracking gets confused when kids overlap or crouch close together, and with very small
  children or poor light. M5b is the planned answer.
* Left/right is mirrored like a mirror. Poses are symmetrical on purpose to avoid confusion.
* Sound starts only after the first key press or click, a browser rule. A grown-up pressing SPACE
  to start handles that, but the arms-out auto-start alone starts the game silent.
* Kids who sit out the lobby watch until they hold their arms out for 2 s, or the grown-up presses Esc. Anyone
  who walks into view *after* the game started also watches until they do that.
* Recognising a returning kid by clothing colours fails when siblings wear the same colours or the lighting
  changes a lot; they then come back as watchers and rejoin with arms out.
* Port 8137 is used because another program here already uses 8000.
  Change it with the `PORT` environment variable.
