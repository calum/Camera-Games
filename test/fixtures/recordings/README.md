# Recordings from real play

Debug recordings (`.json`, saved with **R** in `?debug` mode, see the README) of real play. `test/unit/recording.test.js`
plays every file here through the real tracking code (who is who, smoothing, poses), so a clip of something
that went wrong becomes a regression test once it is fixed.

Add an `expect` field at the top level of the file to say what should happen:

- `"expect": { "players": 2 }`: exactly 2 players almost all the time (no kids lost, no ghosts)
- `"expect": { "maxPlayers": 2 }`: never more than 2 (no ghosts or pets joining)

Recordings hold skeletons and clothing colours only, never pictures. Don't commit the screen videos.
