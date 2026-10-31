import type { WebSocket } from 'ws';
import type { ServerEvent } from '@nodara/shared';

/**
 * In-process fan-out of realtime events to connected WebSocket clients.
 *
 * Nodara runs as a single process (modular monolith), so an in-memory hub is
 * sufficient. To scale horizontally, swap `publish` for PostgreSQL
 * LISTEN/NOTIFY or Redis pub/sub — callers only depend on this interface.
 */
export class RealtimeHub {
  private sockets = new Map<string, Set<WebSocket>>();

  add(userId: string, ws: WebSocket) {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(ws);
  }

  remove(userId: string, ws: WebSocket) {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.sockets.delete(userId);
  }

  publish(userIds: Iterable<string>, event: ServerEvent) {
    const payload = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      for (const ws of this.sockets.get(id) ?? []) {
        if (ws.readyState === 1) ws.send(payload);
      }
    }
  }

  disconnectUser(userId: string) {
    for (const ws of this.sockets.get(userId) ?? []) ws.close(4001, 'session ended');
    this.sockets.delete(userId);
  }

  get connectionCount() {
    let n = 0;
    for (const s of this.sockets.values()) n += s.size;
    return n;
  }
}
