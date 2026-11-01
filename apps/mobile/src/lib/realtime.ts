import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getItem, KEYS } from './storage';
import type { MemberLocation, ServerEvent } from './types';

function apply(qc: QueryClient, e: ServerEvent) {
  switch (e.type) {
    case 'location':
      qc.setQueriesData<MemberLocation[]>({ queryKey: ['live'] }, (old) => old?.map((m) => (m.id === e.userId ? { ...m, location: e.location } : m)));
      break;
    case 'notification':
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['place-events'] });
      break;
    case 'trip':
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['driving'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
      qc.invalidateQueries({ queryKey: ['live'] });
      break;
    case 'presence':
      qc.invalidateQueries({ queryKey: ['place-events'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
    // falls through
    case 'profile':
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['circle'] });
      qc.invalidateQueries({ queryKey: ['place-events'] });
    // falls through
    case 'sharing':
    case 'circle':
      qc.invalidateQueries({ queryKey: ['live'] });
      qc.invalidateQueries({ queryKey: ['circles'] });
      qc.invalidateQueries({ queryKey: ['places'] });
      break;
  }
}

/** Live updates over the server's WebSocket while the app is in the foreground. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = async () => {
      const [server, token] = await Promise.all([getItem(KEYS.server), getItem(KEYS.session)]);
      if (!server || !token || stopped) return;
      const url = server.replace(/^http/, 'ws') + '/api/ws';
      // React Native's WebSocket accepts headers, so we authenticate with the bearer session.
      const Socket = WebSocket as unknown as new (u: string, p: undefined, o: { headers: Record<string, string> }) => WebSocket;
      ws = new Socket(url, undefined, { headers: { Authorization: `Bearer ${token}` } });
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        qc.invalidateQueries({ queryKey: ['live'] });
      };
      ws.onmessage = (m) => {
        try {
          apply(qc, JSON.parse(String(m.data)) as ServerEvent);
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && (!ws || ws.readyState > 1)) {
        clearTimeout(timer);
        attempt = 0;
        void connect();
      } else if (s === 'background') {
        ws?.close();
      }
    });
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      sub.remove();
      ws?.close();
    };
  }, [enabled, qc]);
  return connected;
}
