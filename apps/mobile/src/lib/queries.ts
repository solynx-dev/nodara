import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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

/** Recent arrivals/departures, plus the latest one per person (for "At Home since 7:32 PM" and map callouts). */
export function usePlaceEvents() {
  const q = useQuery({ queryKey: ['place-events', 'recent'], queryFn: () => api.get<PlaceEvent[]>('/api/place-events?limit=100'), refetchInterval: 120_000 });
  return useMemo(() => {
    const byUser = new Map<string, PlaceEvent>();
    for (const e of q.data ?? []) if (!byUser.has(e.user.id)) byUser.set(e.user.id, e);
    return { list: q.data ?? [], byUser };
  }, [q.data]);
}

export type TimelineItem =
  | { type: 'stay'; startAt: string; endAt: string; lat: number; lon: number; label: string | null; placeId: string | null }
  | { type: 'trip'; trip: Trip };

/** Stays and trips for one person on one day (0 = today, 1 = yesterday…). */
export function useDayTimeline(userId: string, daysAgo = 0) {
  return useQuery({
    queryKey: ['timeline', userId, daysAgo, new Date().toDateString()],
    queryFn: () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - daysAgo);
      const to = daysAgo === 0 ? new Date(Date.now() + 60_000) : new Date(from.getTime() + 86_400_000);
      return api
        .get<{ items: TimelineItem[] }>(`/api/history/${userId}/timeline?from=${from.toISOString()}&to=${to.toISOString()}`)
        .then((r) => r.items);
    },
    refetchInterval: daysAgo === 0 ? 120_000 : false,
  });
}

const PAGE = 15;

/** Every drive, newest first, loaded a page at a time. */
export function useTripPages(userId: string) {
  return useInfiniteQuery({
    queryKey: ['trips', userId, 'pages'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Trip[]>(`/api/trips?userId=${userId}&limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.startedAt : undefined),
  });
}

/** Trips started in the last 7 calendar days (for the weekly summary). */
export function useWeekTrips(userId: string) {
  return useQuery({
    queryKey: ['trips', userId, 'week', new Date().toDateString()],
    queryFn: () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - 6);
      return api.get<Trip[]>(`/api/trips?userId=${userId}&from=${from.toISOString()}&limit=200`);
    },
  });
}
