# Public Release Plan (rough)

Goal: make the game easy and accessible for any family with young children, using **whatever camera they
have**: a phone (the lowest barrier to entry) or a webcam with a wide field of view (the best picture). The
game is shown on the TV.

This is the product and release plan: who it is for, how a parent gets playing, safety, accessibility and
distribution. It is a rough outline; details come after the base game is solid. Related plans, each with one job:

- [PLAN.md](PLAN.md): the game's technical plan, architecture and roadmap.
- [PLAYGROUND-PLAN.md](PLAYGROUND-PLAN.md): the camera-confirm step and "Paint your playground" calibration. It is
  the single plan for calibrating the play area, so this document does not repeat it.

## 1. Core game (now)

- Keep the base mechanics working reliably on a laptop with a webcam, which is what we build and test with.
- Keep frame rate and tracking stable in a typical living room, including with small children.
- Keep a phone working as the camera too (see section 2), without making the game depend on one phone model.

## 2. Camera options and getting started

Two routes, and a family should be able to start with whichever they already have.

| | Phone | Webcam with a wide field of view |
|---|---|---|
| Barrier to entry | Lowest: everyone has one | Needs a webcam (and a laptop) |
| Field of view | Often wide if the ultra-wide lens can be used | Best choice if it is 90 degrees or more |
| Picture and delay | Varies by phone and app; Wi-Fi adds delay, USB less | Good picture, lowest delay (USB) |
| Setup | A phone-as-webcam app on phone and laptop | Plug it in |
| Status | Works today: open the hosted game on the phone or tablet, or use a phone-as-webcam app | Works today |

What we have learned so far:

- **The lens is chosen by the phone app, not the game.** Our first try (a Pixel 6a rear camera through a
  webcam app) could not get the ultra-wide lens through to the game, and the picture was not good enough. A
  web page cannot switch a phone's lens on its own, so the guide has to say "pick the wide lens in your app,
  if it has one".
- **Field of view matters more than the camera.** At 2.5 m a typical 70-80 degree webcam sees roughly 3.5 m
  wide and 2 m tall, which is enough for two or three kids but not for a wide group. The game asks for a
  16:9 picture, though some webcams give no wider view for that.
- **Phone or tablet play** (the game running on the device, connected or mirrored to the TV) works from
  https://calum.github.io/kids-camera-games/: touch buttons (Start, Next level, Menu, Camera, Full screen),
  a full-screen note, wake lock and lighter tracking. A tablet on a USB-C to HDMI cable is the simplest setup.

### Setup guide (draft, to become a one-page guide)

Steps marked *(planned)* do not exist yet; see [PLAYGROUND-PLAN.md](PLAYGROUND-PLAN.md).

**With a webcam**

1. **What you need:** a laptop, a webcam, and a TV or monitor on HDMI (or just the laptop screen). No install:
   the game is at https://calum.github.io/kids-camera-games/ (Node.js only to run your own copy).
2. **Choosing a webcam:** USB, 720p at 30 frames a second or better, and the widest field of view you can get
   (around 90 degrees or more). Check reviews to see whether the wide view is kept at 720p.
3. **Place it:** on top of the TV, centred, tilted slightly down. Kids stand 2-3 m back with their whole body
   and arm span in view. Light the room from the front, with no window behind them. Put the TV in Game mode.
4. **Start:** open the game, click Allow for the camera, and press **F** for fullscreen. The first time, a
   10-second setup check looks at the camera, light, distance and speed (and graphics acceleration) and says
   what to fix.
5. **Check the camera:** press **C** if it picked the wrong one. *(planned: a confirm step that shows the whole
   camera picture before anything is hidden.)*
6. **Choose the play area:** *(planned)* the kids run around and colour in the area they want to play in.
7. **Join:** every kid who wants to play holds their arms out like an airplane for 3 seconds.
8. **If something is off:** press **D** for what the game sees, **B** for the plain camera picture, and try
   `?cam=standard`.

**With a phone**

1. Install a phone-as-webcam app on the phone and the laptop (on Windows 11 with an Android phone, Link to
   Windows can do this). Connect by USB if you can, which is faster than Wi-Fi.
2. If the app offers a wide or 0.5x lens, choose it. Hold the phone **landscape**.
3. Prop the phone steadily against the TV, centred, with cables out of children's reach.
4. Start the game and press **C** until the phone's picture appears. The game remembers the choice.
5. Carry on from step 5 of the webcam guide.

## 3. Setup that needs no instructions

- A parent can start a session without reading anything: open the game, allow the camera, pick the camera.
- Play-area calibration is covered by [PLAYGROUND-PLAN.md](PLAYGROUND-PLAN.md).
- Show a clear "step back" prompt when nobody is detected.
- Pick a player count by who holds their arms out (already built), not by a menu.

## 4. Designed for toddlers

- Big, simple targets and short rounds, with no reading required.
- Rely on sound, colour and movement cues, not text.
- Keep sessions short. The game should pause easily when a child wanders off.
- Parent-controlled timer and a clear way to stop.

## 5. Accessibility

- Seated play for children who cannot stand for long, and for families with limited space.
- A non-camera fallback (on-screen or keyboard/switch control) for children who cannot or will not use the
  camera. Mouse mode is a start.
- Colour-blind-safe palettes, and captions for any sound cues.

## 6. Safety and privacy

- Tell parents that everything runs on the device and nothing is uploaded. Family play across homes is the
  exception: it is off until a grown-up opens a room, and then sends the picture and voice only to the invited
  family, browser to browser (see [ONLINE.md](ONLINE.md#privacy)).
- Include a short safety note: where to place the camera or phone, and keeping cables and the phone out of
  children's reach.
- Check the legal requirements for children's data and online services in each target market before
  publishing widely, even though nothing leaves the device.

## 7. Distribution and polish

- Hosted on GitHub Pages from `main` (`.github/workflows/pages.yml`), with relative paths, a service worker
  for offline play after the first visit, and a manifest so it installs as a full-screen app.
- Landing page with the setup guide above, and a short video of the setup.
- Test with real families before a wider release.

## Open questions

- Which phone route first: the phone-as-webcam apps we have now, or the game running on the phone itself?
- Which minimum webcam specification do we recommend, and do we name specific models?
- Should the game ask for a child's age or height to tune the play area?
- ~~Do we need a server for anything?~~ No: everything runs on the device and the site is static. Family play
  adds only a tiny pairing service on Cloudflare, which never sees the video.
