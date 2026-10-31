import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';

/**
 * WebSocket endpoint for live updates. Authenticated with the session cookie
 * (or bearer token) during the HTTP upgrade. Clients only receive events the
 * server explicitly addresses to them; no client-side filtering is trusted.
 */
export default async function realtimeRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const a = req.auth;
    if (!a || a.state !== 'active' || a.via === 'device') {
      socket.close(4401, 'unauthorized');
      return;
    }
    // Same-origin check: browsers always send Origin on WebSocket upgrades.
    const origin = req.headers.origin;
    if (origin && origin !== ctx.config.origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          socket.close(4403, 'forbidden origin');
          return;
        }
      } catch {
        socket.close(4403, 'forbidden origin');
        return;
      }
    }
    ctx.hub.add(a.userId, socket);
    socket.send(JSON.stringify({ type: 'hello', userId: a.userId }));
    const ping = setInterval(() => socket.readyState === 1 && socket.ping(), 25_000);
    socket.on('message', (raw) => {
      // The only client message is an application-level ping.
      if (raw.toString() === 'ping') socket.send('{"type":"pong"}');
    });
    socket.on('close', () => {
      clearInterval(ping);
      ctx.hub.remove(a.userId, socket);
    });
  });
}
