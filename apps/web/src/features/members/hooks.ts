import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/queries';

/** Reverse-geocoded label for a coordinate (server-cached, ~11 m resolution). */
export function useAddress(lat: number | undefined, lon: number | undefined) {
  const { data: config } = useConfig();
  const key = lat != null && lon != null ? `${lat.toFixed(4)},${lon.toFixed(4)}` : null;
  return useQuery({
    queryKey: ['address', key],
    enabled: Boolean(key && config?.geocoding),
    queryFn: () => api.get<{ label: string | null }>(`/api/geocode/reverse?lat=${lat}&lon=${lon}`).then((r) => r.label),
    staleTime: Infinity,
  });
}
