# Family play: kids and grandparents on one screen

**Status: prototype.** Two browser windows on one machine pair with a room code and play together over a real
WebRTC connection. There is no cloud part yet, so it does not work between two homes. The feasibility study is
in the project's `design/online-multiplayer.md`.

## Try it

1. Start the game (`node server.mjs`) and open it. In the menu press **O** (or tap the **Family** button): the
   screen shows a four-letter room code.
2. In a second browser **window** on the same machine open `http://localhost:8137/?room=CODE`. (A second *tab*
   would be hidden behind the first and a hidden page stops drawing, so use a window.)
3. The guest's window shows the host's game. The host sees the guest cut out into the same scene, and the guest
   joins the lobby by holding their arms out, like any other kid. **O** again closes the room (or leaves it).

`?mouse` works for both sides (the guest then sends only a skeleton, no cut-out).

## How it works

```
 guest                                          host (runs the game)
 camera > pose > cut-out ---- video (cut-out as a double-wide frame) ---->  draws the guest into the scene
         > skeletons     ---- data channel, 30/s, positions as fractions -> RemoteCrowd > g.players
 shows the host's picture <------------- video (the host's canvas) -------  runs levels, scoring, lobby
```

- `src/online.js`: pure and unit tested. Room codes, `packPlayers` / `RemoteCrowd` (a guest's skeleton becomes a
  `Player` with `remote: true`, so levels need no changes), and `decodeDoubleWide`.
- `src/family.js`: the WebRTC and canvas glue. `Signal` (pairing) is a `BroadcastChannel` for now.
- **Cut-out video.** Video has no transparency, so the guest sends one frame twice as wide: the left half is the
  colour picture over black, the right half is how opaque each pixel is. The host rebuilds RGBA from it.
- **Poses are recomputed on the host** from the guest's skeleton (shoulder widths, so scale does not matter), which
  is why a guest joins with arms out exactly like a local kid. Colours skip the slots the host's own kids use.
- **Voices.** Each side sends its microphone and plays the other's through an `<audio>` element, so the kids can
  laugh and shout to the grandparents and the grandparents can talk back. Press **V** to mute your microphone. The
  browser's echo cancellation (on for the microphone) is what stops the TV's speakers coming back down the line; it
  works best when the voices come out of the browser, but a loud TV next to a laptop microphone is the likely
  weak spot: test it with real speakers, and headphones on the grandparents' side avoid it entirely.
- **Game sounds** (the effects the host makes) are not streamed yet; the guest hears the voices only. This needs a
  one-line tap on the audio output in `audio.js`, best done after the sound-effects PR lands.
- Nothing pops: guests stay through short dropouts and are remembered 20 s, like local kids.

## Not done yet

- **Signalling across the internet.** Replace `Signal` with a small cloud function that pairs two browsers by room
  code (Cloudflare Worker + Durable Object is the plan) and add STUN/TURN to `ICE_SERVERS`. Nothing else changes.
- **Real delay is unmeasured.** On one machine the round trip is a few tens of ms. The debug line shows the
  measured round trip. Test with two real homes before tuning anything.
- A guest far from the camera is not scaled up to match the host's kids. Remote
  players could get wider jump windows. The guest and host cut-outs overlap over the whole screen (same room).
- A QR code on the host screen, and typing a code on a guest's menu instead of using a link.
- Only one guest at a time.

## Privacy

Family play is off unless someone opens a room or follows a `?room=` link, and a banner shows while it is on.
Video, voices and skeletons go straight between the two browsers, encrypted by WebRTC; the pairing step sees only the room
code. Playing alone sends nothing anywhere. This changes the "nothing leaves the device" wording in
PUBLIC-PLAN.md to: single-home play never sends anything; family play sends your picture and voice only to the family you
invite.
