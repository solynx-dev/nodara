import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Circle, MemberLocation, PlaceEvent, PlaceWithMeta, Trip } from './types';

/** Live members of one circle, or of every circle when circleId is null. */
export const useLive = (circleId: string | null = null) =>
  useQuery({
    queryKey: ['live', circleId ?? 'all'],
    queryFn: () => api.get<MemberLocation[]>(circleId ? `/api/circles/${circleId}/live` : '/api/live'),
    refetchInterval: 60_000,
  });

export const useCircles = () => useQuery({ queryKey: ['circles'], queryFn: () => api.get<Circle[]>('/api/circles') });

export const usePlaces = () => useQuery({ queryKey: ['places'], queryFn: () => api.get<PlaceWithMeta[]>('/api/places') });

export const useTrips = (userId: string, limit = 30) =>
  useQuery({
    queryKey: ['trips', userId, limit],
    queryFn: () => api.get<Trip[]>(`/api/trips?userId=${userId}&limit=${limit}`).catch(() => [] as Trip[]),
  });

export const useAddress = (lat: number | undefined, lon: number | undefined) =>
  useQuery({
    queryKey: ['address', lat != null && lon != null ? `${lat.toFixed(4)},${lon.toFixed(4)}` : null],
    enabled: lat != null && lon != null,
    queryFn: () => api.get<{ label: string | null }>(`/api/geocode/reverse?lat=${lat}&lon=${lon}`).then((r) => r.label),
    staleTime: Infinity,
  });

/** Most recent arrival/departure per person, for "At Home since 7:32 PM" and map callouts. */
export function useLatestPlaceEvents() {
  const q = useQuery({ queryKey: ['place-events', 'recent'], queryFn: () => api.get<PlaceEvent[]>('/api/place-events?limit=100') });
  return useMemo(() => {
    const byUser = new Map<string, PlaceEvent>();
    for (const e of q.data ?? []) if (!byUser.has(e.user.id)) byUser.set(e.user.id, e);
    return byUser;
  }, [q.data]);
}
