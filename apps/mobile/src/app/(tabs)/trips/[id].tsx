import { useEffect, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { clock, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { C } from '@/lib/theme';
import type { TripDetail } from '@/lib/types';
import { Row, Section } from '@/components/ui';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const units = me.preferences.units;
  const map = useRef<MapView>(null);
  const { data: trip } = useQuery({
    queryKey: ['trips', 'detail', id],
    queryFn: () => api.get<TripDetail>(`/api/trips/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? 15_000 : false),
  });
  const coords = (trip?.route ?? []).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));

  useEffect(() => {
    if (coords.length > 1) setTimeout(() => map.current?.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false }), 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.length]);

  if (!trip) return null;
  const title = `${trip.startLabel ?? 'Somewhere'} → ${trip.status === 'in_progress' ? 'now' : (trip.endLabel ?? 'Somewhere')}`;
  const speeds = trip.samples.map((s) => s.speed).filter((s): s is number => s != null);
  const peak = Math.max(1, ...speeds);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingBottom: 120 }}>
      <Stack.Screen options={{ title: trip.status === 'in_progress' ? 'Live trip' : 'Trip' }} />
      <View style={{ height: 300, marginHorizontal: 16, marginTop: 12, borderRadius: 26, borderCurve: 'continuous', overflow: 'hidden' }}>
        <MapView ref={map} style={{ flex: 1 }} mapType="mutedStandard" pitchEnabled={false}>
          {coords.length > 1 && <Polyline coordinates={coords} strokeColor={C.accent} strokeWidth={5} lineCap="round" lineJoin="round" />}
          {coords[0] && <Marker coordinate={coords[0]} pinColor="#FFB547" title="Start" />}
          {trip.status === 'completed' && coords.length > 1 && <Marker coordinate={coords[coords.length - 1]!} pinColor="#E5384A" title="End" />}
        </MapView>
      </View>
      <Text style={{ fontSize: 22, fontWeight: '700', color: C.label, marginHorizontal: 20, marginTop: 18 }}>{title}</Text>
      <Text style={{ fontSize: 15, color: C.secondaryLabel, marginHorizontal: 20, marginTop: 4, marginBottom: 20 }}>
        {new Date(trip.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {clock(trip.startedAt)}
        {trip.endedAt ? ` – ${clock(trip.endedAt)}` : ''}
      </Text>
      <Section footer={trip.lowConfidence ? 'Sparse or imprecise GPS for this trip — distance and speeds may be underestimated.' : 'Max speed is spike-filtered. Travel mode is estimated from speed.'}>
        <Row icon="road.lanes" title="Distance" value={formatDistance(trip.distanceM, units)} />
        <Row icon="clock.fill" title="Duration" value={formatDuration(trip.durationSec)} />
        <Row icon="figure.walk.motion" title="Moving time" value={formatDuration(trip.movingSec)} />
        <Row icon="gauge.with.dots.needle.67percent" title="Max speed" value={formatSpeed(trip.maxSpeed, units)} />
        <Row icon="gauge.with.dots.needle.33percent" title="Average moving speed" value={formatSpeed(trip.avgMovingSpeed, units)} />
        <Row icon="pause.circle.fill" title="Stops" value={String(trip.stops.length)} last />
      </Section>
      {speeds.length > 3 && (
        <Section title="Speed">
          <View style={{ height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 1, padding: 16 }}>
            {trip.samples.map((s, i) => (
              <View key={i} style={{ flex: 1, height: `${((s.speed ?? 0) / peak) * 100}%`, minHeight: 1, backgroundColor: s.source === 'derived' ? C.accentSoft : C.accent, borderRadius: 1 }} />
            ))}
          </View>
        </Section>
      )}
    </ScrollView>
  );
}
