# Public Release Plan (rough)

Goal: make the game easy and accessible for any family with a toddler, using a phone
propped against the TV as the camera and Chromecast or AirPlay to show the game on the TV.

This is a rough outline. Details come after the base game is solid. See `docs/PLAN.md`
for the game's technical plan.

## 1. Core game (now)

- Keep the base mechanics working reliably on a Pixel 6a with the phone as camera and
  the screen cast to the TV.
- Keep frame rate and tracking stable in a typical living room.

## 2. Setup that needs no instructions

- Parents can start a session without reading anything: open a link, allow the camera,
  pick a player count.
- Auto-calibrate the play area with a simple wave-to-start, so there is no manual setup.
- Show a clear "step back" prompt when nobody is detected.

## 3. Designed for toddlers

- Big, simple targets and short rounds, with no reading required.
- Rely on sound, colour and movement cues, not text.
- Keep sessions short. The game should pause easily when a child wanders off.
- Parent-controlled timer and a clear way to stop.

## 4. Accessibility

- Seated play for children who cannot stand for long, and for families with limited space.
- A non-camera fallback (on-screen or keyboard/switch control) for children who cannot
  or will not use the camera.
- Colour-blind-safe palettes, and captions for any sound cues.

## 5. Safety and privacy

- Tell parents that everything runs on the device and nothing is uploaded.
- Include a short safety note: where to place the phone, and keeping cables and the
  phone out of children's reach.
- Check the legal requirements for children's data and online services in each target
  market before publishing widely, even though nothing leaves the device.

## 6. Distribution and polish

- Host on GitHub Pages. Make it installable as a web app so it works offline after the
  first visit.
- Landing page with a QR code that opens the game on the phone, plus a short video of
  the setup.
- Test with real families before a wider release.

## Open questions

- Is the phone always the camera, or should a laptop or tablet also be supported?
- Should the game ask for a child's age or height to tune the play area?
- Do we need a server for anything, or can everything stay static on GitHub Pages?
