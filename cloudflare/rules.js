// Who may join a room. Pure, so the unit tests can check it without Cloudflare.
//
// A room is two browsers: the host (the TV) opens it, one guest joins it. Nobody can join a room that has no
// host, and a second guest is turned away while the first is connected, so a stranger who guesses a live code
// cannot push a family's guest out or sit in beside them. The host holds a random key it made when it opened the
// room; only that key can take the host's place (the host's own socket coming back after a network blip), so a
// stranger with the code cannot push the real host out either.

export const MAX_MESSAGE = 64 * 1024; // pairing messages are a few KB; anything bigger is not one
const KEY = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * @param {string | null} role  'host' or 'guest'
 * @param {{ host: number, guest: number, hostKey?: string | null }} present  sockets already in the room, and
 *   the key the connected host opened it with
 * @param {string | null} [key]  the key a host brings
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
export function joinDecision(role, present, key = null) {
  if (role === 'host') {
    if (!key || !KEY.test(key)) return { ok: false, status: 400, reason: 'a host needs a key' };
    if (present.host && present.hostKey !== key) return { ok: false, status: 409, reason: 'this room already has a host' };
    return { ok: true }; // a new room, or our own host reconnecting: it replaces its old connection
  }
  if (role === 'guest') {
    if (!present.host) return { ok: false, status: 404, reason: 'no host in this room yet' };
    if (present.guest) return { ok: false, status: 409, reason: 'this room already has a guest' };
    return { ok: true };
  }
  return { ok: false, status: 400, reason: 'role must be host or guest' };
}
