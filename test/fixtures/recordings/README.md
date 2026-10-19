# Recordings from real play

Debug recordings (`.json`, saved with **R** in `?debug` mode, see the README) of real play. `test/unit/recording.test.js`
plays every file here through the real tracking code (who is who, smoothing, poses), so a clip of something
that went wrong becomes a regression test once it is fixed.

Add an `expect` field at the top level of the file to say what should happen:

- `"expect": { "players": 2 }`: exactly 2 players almost all the time (no kids lost, no ghosts)
- `"expect": { "maxPlayers": 2 }`: never more than 2 (no ghosts or pets joining)
- `"expect": { "ids": 2 }`: at most 2 different player ids over the whole clip (nobody lost and re-admitted as someone new)
- `"expect": { "maxRise": 1.5 }`: nobody's shoulders move more than 1.5 shoulder widths up or down within 0.25 s
  (an id that jumps from a standing kid to a grown-up on the sofa has been given to the wrong body)
- `"expect": { "jumps": 4, "ducks": 4 }`: in a clip of one player, exactly that many jumps and ducks are seen

Clips so far:

- `sofa-watcher-2026-10-18.json`: one player playing Dodge the rocks with a grown-up lying on the sofa in the middle of
  the picture, both in dark clothes in a dim room. The model often finds only one of the two bodies in a frame.
- `duck-and-jump-2026-10-19.json`: one grown-up playing Duck and jump: 4 jumps over logs and 4 deep ducks under birds.
  Standing up from a deep duck used to count as a jump and froze the duck baseline, so the next duck was seen late.

Recordings hold skeletons and clothing colours only, never pictures. Don't commit the screen videos.
