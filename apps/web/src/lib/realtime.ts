import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { MemberLocation, ServerEvent } from '@nodara/shared';

type Listener = (e: ServerEvent) => void;
const listeners = new Set<Listener>();
export function onServerEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function apply(qc: QueryClient, e: ServerEvent) {
  switch (e.type) {
    case 'location':
      // Patch every cached live list in place — no refetch needed.
      qc.setQueriesData<MemberLocation[]>({ queryKey: ['live'] }, (old) =>
        old?.map((m) => (m.id === e.userId ? { ...m, location: e.location } : m)),
      );
      break;
    case 'notification':
      qc.invalidateQueries({ queryKey: ['notifications'] });
      break;
    case 'trip':
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['live'] });
      break;
    case 'presence':
      qc.invalidateQueries({ queryKey: ['live'] });
      qc.invalidateQueries({ queryKey: ['places'] });
      qc.invalidateQueries({ queryKey: ['place-events'] });
      break;
    case 'profile':
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['place-events'] });
    // falls through
    case 'sharing':
    case 'circle':
      qc.invalidateQueries({ queryKey: ['live'] });
      qc.invalidateQueries({ queryKey: ['circles'] });
      qc.invalidateQueries({ queryKey: ['circle'] });
      break;
  }
}

export type SocketState = 'connecting' | 'open' | 'closed';

/** Maintains the realtime WebSocket with exponential backoff reconnects. */
export function useRealtime(enabled: boolean): SocketState {
  const qc = useQueryClient();
  const [state, setState] = useState<SocketState>('connecting');
  const retry = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let ping: number | undefined;
    let stopped = false;

    const connect = () => {
      setState('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ws`);
      ws.onopen = () => {
        retry.current = 0;
        setState('open');
        // Catch up on anything missed while disconnected.
        qc.invalidateQueries({ queryKey: ['live'] });
        qc.invalidateQueries({ queryKey: ['notifications'] });
        ping = window.setInterval(() => ws?.readyState === 1 && ws.send('ping'), 30_000);
      };
      ws.onmessage = (msg) => {
        try {
          const e = JSON.parse(msg.data) as ServerEvent;
          apply(qc, e);
          listeners.forEach((l) => l(e));
        } catch {}
      };
      ws.onclose = () => {
        clearInterval(ping);
        setState('closed');
        if (stopped) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry.current++) * (0.75 + Math.random() * 0.5);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ws?.readyState !== 1) {
        clearTimeout(timer);
        retry.current = 0;
        if (ws) {
          ws.onclose = null;
          ws.close();
        }
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
    };
  }, [enabled, qc]);

  return state;
}
