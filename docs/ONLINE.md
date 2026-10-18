# Family play: kids and grandparents on one screen

**Status: prototype, not deployed yet.** Two browser windows pair with a room code and play together over a real
WebRTC connection, with voices and game sounds both ways. The pairing function for two different homes is written
and tested locally, but needs deploying to a Cloudflare account (below). The feasibility study is in the project's
`design/online-multiplayer.md`.

## Try it

1. Start the game (`node server.mjs`) and open it. In the menu press **O** (or tap the **Family** button): the
   screen shows a five-letter room code.
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
- `src/family.js`: the WebRTC and canvas glue. Pairing goes through the Cloudflare function when `SIGNAL_URL` is set, and through a `BroadcastChannel` (two windows on one computer) when it is not.
- **Cut-out video.** Video has no transparency, so the guest sends one frame twice as wide: the left half is the
  colour picture over black, the right half is how opaque each pixel is. The host rebuilds RGBA from it.
- **Poses are recomputed on the host** from the guest's skeleton (shoulder widths, so scale does not matter), which
  is why a guest joins with arms out exactly like a local kid. Colours skip the slots the host's own kids use.
- **Voices.** Each side sends its microphone and plays the other's through an `<audio>` element, so the kids can
  laugh and shout to the grandparents and the grandparents can talk back. Press **V** to mute your microphone. The
  browser's echo cancellation (on for the microphone) is what stops the TV's speakers coming back down the line; it
  works best when the voices come out of the browser, but a loud TV next to a laptop microphone is the likely
  weak spot: test it with real speakers, and headphones on the grandparents' side avoid it entirely.
- **Game sounds.** The host also sends its sound effects (`soundStream()` in `audio.js` taps the same bus the
  speakers use), so the guest hears the pops and cheers. Because they come out of the same browser as the voices,
  the browser's echo cancellation can treat them as speaker sound and keep them out of the host's microphone.
- Nothing pops: guests stay through short dropouts and are remembered 20 s, like local kids.

## Between two homes: the Cloudflare pairing function

`cloudflare/worker.js` is a Worker with one Durable Object per room. Its whole job is to pass the two browsers'
connection details to each other, so they can connect directly with nothing to set up on either router (no port
forwarding, no addresses to type). Nothing is stored; a room exists while its sockets are open.

- `wss://<worker>/room/CODE?role=host|guest`: a room for two browsers. The host opens it; a guest can only join a
  room that has a host, and only one guest at a time (rules in `cloudflare/rules.js`, unit tested). A mistyped code
  finds nobody; a stranger who guesses a live code is turned away while the family is connected.
- `https://<worker>/ice`: the STUN/TURN servers for the connection. STUN alone connects most homes. About one home
  in ten has a router that needs a TURN relay; add Cloudflare's TURN (steps below) and the Worker hands out
  short-lived credentials, so no secret reaches the browser.

**Deploying:** [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md) has the steps, both once from your computer and
automatically from GitHub Actions (two secrets for the deploy, and a `PAIRING_URL` repository variable that the
Pages publish writes into the game, so no code edit is needed). Pricing was not checked; the Worker, the Durable
Object and TURN at family scale should be small, but look at the dashboard after the first evenings.

To try it without deploying: `npx wrangler dev` in `cloudflare/` runs the same Worker on your computer, and
`?signal=http://127.0.0.1:8787` on the game's address (host and guest) points the game at it. The browser test
`FAMILY (Cloudflare pairing function)` does exactly this and runs when `WRANGLER_BIN` points at wrangler.

## Not done yet

- **Real delay is unmeasured.** On one machine the round trip is a few tens of ms. The host shows the measured round
  trip. Test with two real homes before tuning anything.
- **Echo with a loud TV is untested.** See Voices above; needs a real room and real speakers.
- A guest far from the camera is not scaled up to match the host's kids. Remote players could get wider jump
  windows. The guest and host cut-outs overlap over the whole screen (same room).
- A QR code on the host screen, and typing a code on a guest's menu instead of using a link.
- Only one guest at a time. Rooms are not rate limited (add a Cloudflare rate-limiting rule if it is ever abused).

## Privacy

Family play is off unless someone opens a room or follows a `?room=` link, and a banner shows while it is on.
Video, voices and skeletons go straight between the two browsers, encrypted by WebRTC; the pairing step sees only the room
code. Playing alone sends nothing anywhere. This changes the "nothing leaves the device" wording in
PUBLIC-PLAN.md to: single-home play never sends anything; family play sends your picture and voice only to the family you
invite.
