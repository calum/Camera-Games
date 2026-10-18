// Family play pairing, on Cloudflare Workers. One job, tiny:
//
//   wss://<worker>/room/CODE?role=host&key=K   a room for two browsers; whatever one sends, the other gets.
//   wss://<worker>/room/CODE?role=guest        The browsers use it to swap their WebRTC connection details.
//                                              After that, video and voices go straight between them.
//
// The first message on each socket comes from the Worker itself: { from: 'server', ice: [...] }, the STUN/TURN
// servers for the connection, so it works through home routers with nothing to set up. TURN (a relay for the
// roughly one home in ten whose router blocks direct connections) is added when the TURN_KEY_ID and
// TURN_KEY_API_TOKEN secrets are set. Handing them out only on a room socket means only a host, and a guest who
// got into a live room, ever get relay credentials; there is no open address to collect them from.
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
    const params = new URL(request.url).searchParams;
    const role = params.get('role');
    const key = params.get('key');
    const hosts = this.ctx.getWebSockets('host');
    const present = { host: hosts.length, guest: this.ctx.getWebSockets('guest').length, hostKey: hosts[0]?.deserializeAttachment()?.key ?? null };
    const verdict = joinDecision(role, present, key);
    if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status, headers: cors });
    const ice = await iceServers(this.env);
    if (role === 'host') for (const old of this.ctx.getWebSockets('host')) old.close(4000, 'replaced by a newer host');

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    if (role === 'host') server.serializeAttachment({ key });
    server.send(JSON.stringify({ from: 'server', ice })); // before anything the other browser sends
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
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 6 * 3600 }), // longer than any play session
        signal: AbortSignal.timeout(3000), // a slow relay service must not hold up pairing
      });
      if (res.ok) return (await res.json()).iceServers; // STUN plus TURN with short-lived credentials
    } catch {
      // no relay this time: direct connections still work for most homes
    }
  }
  return [STUN];
}
