import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { MemberLocation } from './types';

type RefreshResponse = { requested: boolean; reason?: 'not_visible' | 'paused' | 'no_app' | 'too_soon'; retryAfterSec?: number };

/** How long the button spins waiting for the new location before giving up. */
const WAIT_MS = 30_000;

/**
 * Ask someone's phone for a fresh location. Silent for both of you: their
 * phone shows nothing, and nobody gets a notification. Spins until the new
 * location arrives (or ~30 s). The server allows one per person every 10 s.
 */
export function useLocationRefresh(m: MemberLocation | null) {
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState<{ id: string; since: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordedAt = m?.location?.recordedAt ?? null;

  // A newer location (or a different person) ends the wait.
  const done = !waiting || !m || waiting.id !== m.id || (recordedAt !== null && recordedAt !== waiting.since);
  useEffect(() => {
    if (done && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [done]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const refresh = useCallback(async (): Promise<RefreshResponse['reason'] | null> => {
    if (!m) return null;
    setWaiting({ id: m.id, since: recordedAt });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setWaiting(null), WAIT_MS);
    try {
      const r = await api.post<RefreshResponse>(`/api/users/${m.id}/refresh-location`);
      // too_soon means someone just asked: the update is already on its way.
      if (!r.requested && r.reason !== 'too_soon') {
        setWaiting(null);
        return r.reason ?? null;
      }
      // Realtime normally brings it in; poll a couple of times in case it's off.
      for (const ms of [8_000, 18_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ['live'] }), ms);
      return null;
    } catch {
      setWaiting(null);
      return 'not_visible';
    }
  }, [m, recordedAt, qc]);

  return { refresh, refreshing: !done, canRefresh: Boolean(m?.canRefresh) };
}

export const refreshFailure: Record<string, string> = {
  paused: 'They paused sharing',
  no_app: "Their phone can't be refreshed yet",
  not_visible: "Couldn't refresh right now",
};
