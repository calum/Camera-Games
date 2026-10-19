# Plan: camera setup and "Paint your playground"

Status: **partly superseded.** A simpler play-space check was built first (PR #21, `src/calibrate.js`): after
joining, the kids walk as far as they can each way and the levels keep to that range (`reachX` / `standX` in
`src/levels/kit.js`). The painted playground below, the camera confirm step and a saved playground per camera
are not built. This is the single plan for calibrating the play area; the product
plan in [PUBLIC-PLAN.md](PUBLIC-PLAN.md) links here instead of repeating it. It builds on the camera picker (key
**C**, `src/camera.js`) and the cut-out (`src/person-mask.js`, `src/cutout.js`), which are already built. The
first-launch setup check (`src/setup-check.js`: camera, light, distance, speed) is also built and covers part of
the "is the camera right?" job; the camera step below would come after it. See [PLAN.md](PLAN.md) for the game's
technical plan.

## Why

- Our first try with a phone camera (a Pixel 6a rear camera through a webcam app) could not get the wide lens, so
  we build and test with a normal webcam first. The same setup works for a phone used as a webcam.
- The camera sees more than the kids want to play in (sofa, doorway, TV stand), and the game currently treats
  the whole picture as the playing field, so things can appear where nobody can or should reach.
- Letting the kids colour in the region they want to play in tells the game where interactive things may
  appear, and doubles as a short warm-up.

## What changes for the player

1. **Camera step (every launch).** The full, uncropped camera picture is shown, so you see exactly what the
   camera sees. Nothing is hidden or cut out yet. **C** switches camera, **Enter** confirms.
2. **Level 0, "Paint your playground".** The background is hidden (kids cut out over a cartoon backdrop) with a
   faint 20% ghost of the real room, so the sofa is easy to avoid. As the kids run around and wave, the cells
   they cover light up. When the painted area stops growing for about 2 seconds, "Playground ready" appears.
3. **The picture zooms in to the painted region and fills the screen.** The join-by-arms-out lobby, the level picker
   and the levels then run unchanged.
4. If a saved playground exists for that camera: **Enter** uses it, **P** repaints.

## Decisions

- **Crop = a different picture rectangle.** Today the camera picture is drawn into a rectangle that covers the
  screen. A crop is simply a bigger rectangle that overflows the screen. The tracker's coordinate mapping, the
  cut-out and every level already go through that one rectangle, so **the levels need no changes**, and
  interactive things can never appear outside the painted region because outside it is off-screen.
- **Pose tracking keeps using the whole frame**, so tracking quality does not drop when we crop.
- **Rectangle region**, in the screen's shape (16:9) so nothing is stretched. Freeform shapes would make
  spawning and the floor line messy; the cost is that an L-shaped room includes an unreachable corner.
- **Padding:** headroom on top (jumping), a little at the bottom and sides.
- **Never zoom in too far:** the crop stays at no less than about half the frame (a bigger zoom makes a
  640x480 webcam look soft on the TV). If the crop would exceed the frame, use the full frame.
- **Only kids inside the region count.** A kid in the unpainted part of the frame is still tracked but is
  off-screen, so they cannot join the lobby or score.
- **Level 0 is a setup step**, not part of the replayed loop after the winners screen. Mouse mode (no camera)
  skips the whole setup.
- **Crop off (key Z)** falls back to today's behaviour, so the two can be compared.

## Painting

- **Coverage grid:** the camera frame is split into about 64x36 cells. Each frame a cell gets a hit if the
  cut-out shows a person there (opacity above 0.6); a cell is painted after about 3 hits. This uses the same
  cut-out the game already makes, so it keeps working through pose-tracking glitches.
- **Ignore strays:** the region box comes from the 2nd to 98th percentile of the painted cells, so a parent
  walking past does not stretch it.
- **Finished when** the painted area has not grown by at least 1% of the frame for 2.5 seconds and at least
  about 12% is painted. A progress ring fills as that time builds up. There is a 60 second cap, **Space**
  finishes early, **R** clears. If less than 5% is painted, fall back to the full frame.
- **Saved per camera and picture size** in local storage (key includes the device id and size). Cleared when
  the camera is switched.

## Code changes

- **New `src/playground.js`** (pure maths, no browser): the coverage grid, the "finished" check, the region box,
  the crop rectangle, and save/load.
- **`src/tracker.js`:** the picture rectangle becomes crop-aware and also supports a fit-to-screen mode for the
  camera and painting steps. Kids outside the region are marked as not in the field.
- **`src/cutout.js`:** a small change at most (it already draws into the same rectangle).
- **`src/main.js`:** two new states (camera confirm, paint) before the lobby. Keys: `Enter`, `P` repaint,
  `T` redo the camera step, `Z` crop on/off. The zoom into the crop is eased over about 0.8 s.
- **`?setup=skip`** URL option so the existing tests can bypass setup and stay focused.
- **Docs:** README, CLAUDE.md, llms.txt and PLAN.md updated.

## Tests

- **Unit (no camera):** grid and thresholds; finishing and its cap; strays ignored; crop shape, size, clamping
  and the full-frame fallback; the mapping from camera to screen; saving and loading; the in-field filter.
- **Browser:** the camera step shows the raw picture with no cut-out until Enter; a fake webcam video of the
  test photo sliding across the frame gets painted, finishes and gives a sensible crop; a bystander outside the
  region is ignored; the saved playground is reused after a reload, P repaints, Z toggles the crop; mouse mode
  skips setup.

## Order of work

1. `playground.js` with unit tests, no UI.
2. Crop-aware rectangle, fit-to-screen mode and the in-field filter.
3. The camera step.
4. Level 0, saving, and the keys.
5. Polish (the zoom transition, an optional "whole body in view" check), docs, full test run.

## Risks and open points

- **Soft picture:** a cheap 640x480 webcam will look soft when zoomed in; a 720p or 1080p webcam is much better.
- **Failed tracking:** painting needs the cut-out working. If tracking fails, **Space** accepts the full frame.
- **Static fake feed:** a still photo cannot "run around", so the browser test needs a short video of the photo
  sliding across the frame.
- **Camera bumped:** a saved playground goes wrong if the webcam moves. **P** and **T** are the escape hatches.
- **Not yet decided:** whether the optional "whole body in view" check is worth including in step 5.
