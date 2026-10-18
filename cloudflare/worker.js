// Family play pairing, on Cloudflare Workers. Two jobs, both tiny:
//
//   wss://<worker>/room/CODE?role=host|guest   a room for two browsers; whatever one sends, the other gets.
//                                              The browsers use it to swap their WebRTC connection details.
//                                              After that, video and voices go straight between them.
//   https://<worker>/ice                       STUN/TURN servers for the connection, so it works through home
//                                              routers with nothing to set up. TURN (a relay for the roughly one
//                                              home in ten whose router blocks direct connections) is added when
//                                              the TURN_KEY_ID and TURN_KEY_API_TOKEN secrets are set.
//
// Nothing is stored. A room exists while its sockets are open. See docs/ONLINE.md for deploying.
import { DurableObject } from 'cloudflare:workers';
import { normaliseCode } from '../src/room-code.js';
import { joinDecision, MAX_MESSAGE } from './rules.js';

const STUN = { urls: ['stun:stun.cloudflare.com:3478'] };

const cors = {
  'Access-Control-Allow-Origin': '*', // the game is served from another address (GitHub Pages)
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export class Room extends DurableObject {
  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role');
    const present = { host: this.ctx.getWebSockets('host').length, guest: this.ctx.getWebSockets('guest').length };
    const verdict = joinDecision(role, present);
    if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status, headers: cors });
    if (role === 'host') for (const old of this.ctx.getWebSockets('host')) old.close(4000, 'replaced by a newer host');

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(message);
  }

  async webSocketClose(ws, code) {
    ws.close(code === 1005 || code === 1006 ? 1000 : code); // 1005/1006 may not be sent back
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/ice') return iceServers(env);

    const m = url.pathname.match(/^\/room\/([A-Za-z]+)$/);
    if (m) {
      const code = normaliseCode(m[1]);
      if (!code) return new Response('bad room code', { status: 400, headers: cors });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426, headers: cors });
      return env.ROOM.getByName(code).fetch(request);
    }
    return new Response('Kids Camera Game pairing. Nothing to see here.', { headers: cors });
  },
};

async function iceServers(env) {
  let servers = [STUN];
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 6 * 3600 }), // longer than any play session
      });
      if (res.ok) servers = (await res.json()).iceServers; // STUN plus TURN with short-lived credentials
    } catch {
      // no relay this time: direct connections still work for most homes
    }
  }
  return Response.json({ iceServers: servers }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
}
