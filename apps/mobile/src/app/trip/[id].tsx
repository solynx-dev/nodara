import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { appear } from '@/lib/motion';
import { Stack, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useLive } from '@/lib/queries';
import { clock, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { C, HEX, T } from '@/lib/theme';
import type { TripDetail } from '@/lib/types';
import { Avatar, Skeleton, StatusPill } from '@/components/ui';
import { modeIcon, tripTitle } from '@/features/trips/Drives';
import { EventList } from '@/features/driving/components';
import { KIND_INFO } from '@/lib/driving';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const units = me.preferences.units;
  const map = useRef<MapView>(null);
  const { data: members = [] } = useLive();
  const { data: trip, isLoading } = useQuery({
    queryKey: ['trips', 'detail', id],
    queryFn: () => api.get<TripDetail>(`/api/trips/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? 15_000 : false),
  });
  const coords = useMemo(() => (trip?.route ?? []).map(([lon, lat]) => ({ latitude: lat, longitude: lon })), [trip?.route]);
  const person = members.find((m) => m.id === trip?.userId);

  useEffect(() => {
    if (coords.length > 1) setTimeout(() => map.current?.fitToCoordinates(coords, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true }), 250);
  }, [coords]);

  if (isLoading || !trip) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Skeleton height={300} />
        <Skeleton height={120} />
        <Skeleton height={160} />
      </ScrollView>
    );
  }

  const liveTrip = trip.status === 'in_progress';
  const speeds = trip.samples.map((s) => s.speed);
  const valid = speeds.filter((s): s is number => s != null);
  const peak = Math.max(1, ...valid);
  const avg = trip.avgMovingSpeed ?? 0;
  const factor = units === 'imperial' ? 2.236936 : 3.6;
  const first = coords[0];
  const last = coords[coords.length - 1];

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingBottom: 80, gap: 14 }}>
      <Stack.Screen options={{ title: liveTrip ? 'Live trip' : 'Trip report' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="square.and.arrow.up"
          accessibilityLabel="Share trip"
          onPress={() =>
            void Share.share({
              message: `${tripTitle(trip)} — ${formatDistance(trip.distanceM, units)} in ${formatDuration(trip.durationSec)}, ${new Date(trip.startedAt).toLocaleDateString()} ${clock(trip.startedAt)}`,
            })
          }
        />
      </Stack.Toolbar>

      <Animated.View entering={appear} style={{ height: 320, marginHorizontal: 16, marginTop: 8, borderRadius: 28, borderCurve: 'continuous', overflow: 'hidden' }}>
        <MapView ref={map} style={{ flex: 1 }} mapType="mutedStandard" pitchEnabled={false} showsPointsOfInterests={false}>
          {coords.length > 1 && <Polyline coordinates={coords} strokeColor="rgba(0,0,0,0.25)" strokeWidth={9} lineCap="round" lineJoin="round" />}
          {coords.length > 1 && <Polyline coordinates={coords} strokeColor="#FF6B3D" strokeWidth={5} lineCap="round" lineJoin="round" />}
          {first && (
            <Marker coordinate={first} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title="Start">
              <Pin color={HEX.green} icon="flag.fill" />
            </Marker>
          )}
          {trip.stops.map((s, i) => (
            <Marker key={i} coordinate={{ latitude: s.lat, longitude: s.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={`Stopped ${formatDuration(s.durationSec)}`}>
              <Pin color={HEX.gray} icon="pause.fill" small />
            </Marker>
          ))}
          {last && !liveTrip && coords.length > 1 && (
            <Marker coordinate={last} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title="End">
              <Pin color={HEX.red} icon="flag.checkered" />
            </Marker>
          )}
          {(trip.events ?? []).map((e) => (
            <Marker key={`ev-${e.id}`} coordinate={{ latitude: e.lat, longitude: e.lon }} tracksViewChanges={false} title={KIND_INFO[e.kind].label} description={clock(e.startedAt)}>
              <Pin color={KIND_INFO[e.kind].color} icon={KIND_INFO[e.kind].icon} small />
            </Marker>
          ))}
        </MapView>
      </Animated.View>

      <Animated.View entering={appear} style={{ paddingHorizontal: 20, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {person && <Avatar name={person.displayName} color={person.avatarColor} url={person.avatarUrl} size={26} />}
          <Text style={[T.subhead, { color: C.secondaryLabel }]}>
            {person ? (person.id === me.id ? 'You' : person.displayName) : ''} · {new Date(trip.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <Text style={[T.title2, { color: C.label }]}>{tripTitle(trip)}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill icon={modeIcon(trip)} text={`${trip.mode === 'unknown' ? 'Trip' : trip.mode[0]!.toUpperCase() + trip.mode.slice(1)} (estimated)`} color={HEX.blue} />
          {liveTrip && <StatusPill icon="dot.radiowaves.left.and.right" text="Happening now" color={HEX.green} />}
          {trip.lowConfidence && <StatusPill icon="exclamationmark.triangle.fill" text="Low GPS quality" color={HEX.orange} />}
        </View>
      </Animated.View>

      <Animated.View entering={appear} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 }}>
        <Stat icon="road.lanes" label="Distance" value={formatDistance(trip.distanceM, units)} />
        <Stat icon="clock.fill" label="Duration" value={formatDuration(trip.durationSec)} sub={`${formatDuration(trip.movingSec)} moving`} />
        <Stat icon="gauge.with.dots.needle.67percent" label="Top speed" value={formatSpeed(trip.maxSpeed, units)} sub="Spikes filtered out" />
        <Stat icon="gauge.with.dots.needle.33percent" label="Average" value={formatSpeed(trip.avgMovingSpeed, units)} sub="While moving" />
      </Animated.View>

      {valid.length > 3 && (
        <Animated.View entering={appear} style={card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={[T.headline, { color: C.label }]}>Speed</Text>
            <Text style={[T.footnote, { color: C.secondaryLabel }]}>peak {Math.round(peak * factor)} {units === 'imperial' ? 'mph' : 'km/h'}</Text>
          </View>
          <View style={{ height: 130 }}>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: (avg / peak) * 130, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.secondaryLabel as string }} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
              {speeds.map((sp, i) => (
                <View key={i} style={{ flex: 1, height: `${((sp ?? 0) / peak) * 100}%`, minHeight: 1, backgroundColor: trip.samples[i]?.source === 'derived' ? 'rgba(255,107,61,0.4)' : '#FF6B3D', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={[T.caption, { color: C.tertiaryLabel }]}>{clock(trip.startedAt)}</Text>
            <Text style={[T.caption, { color: C.tertiaryLabel }]}>dashed line = average</Text>
            <Text style={[T.caption, { color: C.tertiaryLabel }]}>{trip.endedAt ? clock(trip.endedAt) : 'now'}</Text>
          </View>
        </Animated.View>
      )}

      {trip.events && (
        <Animated.View entering={appear} style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={[T.headline, { color: C.label }]}>Driving events</Text>
            {trip.events.length > 0 && <Text style={[T.footnote, { color: C.secondaryLabel }]}>{trip.events.length} on this trip</Text>}
          </View>
          {trip.events.length ? (
            <EventList events={trip.events} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SymbolView name="checkmark.seal.fill" size={18} tintColor={HEX.green} />
              <Text style={[T.subhead, { color: C.label }]}>No speeding, phone use, hard braking or rapid acceleration.</Text>
            </View>
          )}
        </Animated.View>
      )}

      <Animated.View entering={appear} style={card}>
        <Text style={[T.headline, { color: C.label, marginBottom: 12 }]}>Route</Text>
        <Step icon="flag.fill" color={HEX.green} title={trip.startLabel ?? 'Start'} sub={`Left at ${clock(trip.startedAt)}`} />
        {trip.stops.map((s, i) => (
          <Step key={i} icon="pause.fill" color={HEX.gray} title={`Stopped for ${formatDuration(s.durationSec)}`} sub={`${clock(s.arrivedAt)} – ${clock(s.departedAt)}`} />
        ))}
        <Step icon={liveTrip ? 'location.fill' : 'flag.checkered'} color={liveTrip ? HEX.blue : HEX.red} title={liveTrip ? 'Still travelling' : (trip.endLabel ?? 'End')} sub={trip.endedAt ? `Arrived at ${clock(trip.endedAt)}` : 'Updating live'} last />
      </Animated.View>

      <Text style={[T.footnote, { color: C.secondaryLabel, marginHorizontal: 24, lineHeight: 18 }]}>
        {trip.lowConfidence
          ? 'This trip had sparse or imprecise GPS (for example while the app was limited in the background), so distance and speeds may be underestimated. '
          : ''}
        Speeds come from GPS. Lighter bars are estimated from distance between points. Driving events are estimates from GPS speed and phone unlocks, not an insurance score.
      </Text>
    </ScrollView>
  );
}

const card = { backgroundColor: C.cell, borderRadius: 26, borderCurve: 'continuous' as const, padding: 16, marginHorizontal: 16 };

function Pin({ color, icon, small }: { color: string; icon: SFSymbol; small?: boolean }) {
  const s = small ? 22 : 30;
  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color, borderWidth: 3, borderColor: 'white', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
      <SymbolView name={icon} size={small ? 9 : 13} tintColor="white" />
    </View>
  );
}

function Stat({ icon, label, value, sub }: { icon: SFSymbol; label: string; value: string; sub?: string }) {
  return (
    <View style={{ width: '48%', flexGrow: 1, backgroundColor: C.cell, borderRadius: 22, borderCurve: 'continuous', padding: 14, gap: 4 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SymbolView name={icon} size={13} tintColor={C.secondaryLabel} />
        <Text style={[T.caption, { color: C.secondaryLabel, textTransform: 'uppercase' }]}>{label}</Text>
      </View>
      <Text style={[T.title2, { color: C.label }]} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
      {sub && <Text style={[T.footnote, { color: C.secondaryLabel }]}>{sub}</Text>}
    </View>
  );
}

function Step({ icon, color, title, sub, last }: { icon: SFSymbol; color: string; title: string; sub: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ alignItems: 'center', width: 28 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name={icon} size={12} tintColor="white" />
        </View>
        {!last && <View style={{ width: 2, flex: 1, minHeight: 12, backgroundColor: C.separator, marginVertical: 2 }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
        <Text style={[T.subhead, { color: C.label, fontWeight: '600' }]}>{title}</Text>
        <Text style={[T.footnote, { color: C.secondaryLabel }]}>{sub}</Text>
      </View>
    </View>
  );
}
