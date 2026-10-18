// Who may join a room. Pure, so the unit tests can check it without Cloudflare.
//
// A room is two browsers: the host (the TV) opens it, one guest joins it. Nobody can join a room that has no
// host, and a second guest is turned away while the first is connected, so a stranger who guesses a live code
// cannot push a family's guest out or sit in beside them.

export const MAX_MESSAGE = 64 * 1024; // pairing messages are a few KB; anything bigger is not one

/**
 * @param {string | null} role  'host' or 'guest'
 * @param {{ host: number, guest: number }} present  sockets already in the room
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
export function joinDecision(role, present) {
  if (role === 'host') return { ok: true }; // a reloaded host replaces the old connection
  if (role === 'guest') {
    if (!present.host) return { ok: false, status: 404, reason: 'no host in this room yet' };
    if (present.guest) return { ok: false, status: 409, reason: 'this room already has a guest' };
    return { ok: true };
  }
  return { ok: false, status: 400, reason: 'role must be host or guest' };
}
