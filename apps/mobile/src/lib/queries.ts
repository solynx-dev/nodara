import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Circle, MemberLocation, PlaceWithMeta, Trip } from './types';

export const useLive = () =>
  useQuery({ queryKey: ['live', 'all'], queryFn: () => api.get<MemberLocation[]>('/api/live'), refetchInterval: 60_000 });

export const useCircles = () => useQuery({ queryKey: ['circles'], queryFn: () => api.get<Circle[]>('/api/circles') });

export const usePlaces = () => useQuery({ queryKey: ['places'], queryFn: () => api.get<PlaceWithMeta[]>('/api/places') });

export const useTrips = (userId: string, limit = 30) =>
  useQuery({
    queryKey: ['trips', userId, limit],
    queryFn: () => api.get<Trip[]>(`/api/trips?userId=${userId}&limit=${limit}`).catch(() => [] as Trip[]),
  });
