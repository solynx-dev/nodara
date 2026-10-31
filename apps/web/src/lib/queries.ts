import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, PublicConfig } from '@nodara/shared';
import { api, ApiError } from './api';
import type { Circle, MemberLocation } from './types';

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<PublicConfig>('/api/config'), staleTime: 60_000 });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

/** The current user; only use inside authenticated routes. */
export function useUser(): Me {
  const { data } = useMe();
  if (!data) throw new Error('useUser outside an authenticated route');
  return data;
}

export function useCircles() {
  return useQuery({ queryKey: ['circles'], queryFn: () => api.get<Circle[]>('/api/circles') });
}

/** Live member locations, kept current by the realtime socket. */
export function useLive(circleId: string | null) {
  return useQuery({
    queryKey: ['live', circleId ?? 'all'],
    queryFn: () => api.get<MemberLocation[]>(circleId ? `/api/circles/${circleId}/live` : '/api/live'),
    refetchInterval: 60_000,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
