import { Linking, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useLive, useTrips } from '@/lib/queries';
import { ago, clock, coords, formatDistance, formatDuration, formatSpeed, freshness } from '@/lib/format';
import { C } from '@/lib/theme';
import { Avatar, Row, Section } from '@/components/ui';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function MemberSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const units = me.preferences.units;
  const { data: members = [] } = useLive();
  const m = members.find((x) => x.id === id);
  const loc = m?.location ?? null;
  const { data: address } = useQuery({
    queryKey: ['address', loc && `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`],
    enabled: Boolean(loc),
    queryFn: () => api.get<{ label: string | null }>(`/api/geocode/reverse?lat=${loc!.lat}&lon=${loc!.lon}`).then((r) => r.label),
    staleTime: Infinity,
  });
  const { data: trips = [] } = useTrips(id, 3);
  if (!m) return null;

  const f = freshness(loc?.recordedAt);
  const moving = loc && (loc.speed ?? 0) > 1 && f === 'live';
  const where = !loc ? (m.sharing ? 'No location yet' : 'Not sharing location') : m.currentPlace ? `At ${m.currentPlace.name}` : (address ?? coords(loc.lat, loc.lon));

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 28, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, marginBottom: 20 }}>
        <Avatar name={m.displayName} color={m.avatarColor} size={60} ring={f === 'live'} dim={f === 'old'} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: C.label }} numberOfLines={1}>
            {m.id === me.id ? `${m.displayName} (you)` : m.displayName}
          </Text>
          <Text style={{ fontSize: 15, color: C.secondaryLabel }} numberOfLines={2}>
            {where}
          </Text>
        </View>
      </View>

      {loc && (f === 'stale' || f === 'old') && (
        <View style={{ marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,149,0,0.14)', flexDirection: 'row', gap: 10 }}>
          <SymbolView name="clock.badge.exclamationmark" size={20} tintColor={C.orange} />
          <Text style={{ flex: 1, color: C.label, fontSize: 14, lineHeight: 19 }}>
            Last known location from {ago(loc.recordedAt)} ({clock(loc.recordedAt)}). Their phone may be offline or not sharing in the background.
          </Text>
        </View>
      )}

      {loc && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginBottom: 24 }}>
          <Tile icon="dot.radiowaves.left.and.right" label="Updated" value={f === 'live' ? 'Live' : ago(loc.recordedAt)} tone={f === 'live' ? C.green : f === 'recent' ? undefined : C.orange} />
          <Tile icon="speedometer" label="Speed" value={loc.speed == null ? '—' : moving ? formatSpeed(loc.speed, units) : 'Still'} sub={moving && loc.heading != null ? `Heading ${COMPASS[Math.round(loc.heading / 45) % 8]}` : undefined} />
          <Tile icon={loc.charging ? 'battery.100percent.bolt' : (loc.battery ?? 100) <= 20 ? 'battery.25percent' : 'battery.75percent'} label="Battery" value={loc.battery != null ? `${loc.battery}%` : '—'} tone={loc.battery != null && loc.battery <= 15 && !loc.charging ? C.red : undefined} />
          <Tile icon="scope" label="Accuracy" value={loc.accuracy != null ? `±${formatDistance(loc.accuracy, units)}` : '—'} sub={m.deviceName ?? undefined} />
        </View>
      )}

      {loc && m.id !== me.id && (
        <Section>
          <Row icon="arrow.triangle.turn.up.right.diamond.fill" iconColor="#007AFF" title="Directions" subtitle="Open in Apple Maps" onPress={() => Linking.openURL(`maps://?daddr=${loc.lat},${loc.lon}`)} last />
        </Section>
      )}

      {trips.length > 0 && (
        <Section title="Recent trips">
          {trips.map((t, i) => (
            <Row
              key={t.id}
              icon={t.mode === 'walking' ? 'figure.walk' : t.mode === 'cycling' ? 'bicycle' : 'car.fill'}
              iconColor={t.status === 'in_progress' ? C.accent : '#8E8E93'}
              title={`${t.startLabel ?? 'Somewhere'} → ${t.status === 'in_progress' ? 'now' : (t.endLabel ?? 'Somewhere')}`}
              subtitle={`${clock(t.startedAt)} · ${formatDistance(t.distanceM, units)} · ${formatDuration(t.durationSec)}`}
              onPress={() => {
                router.back();
                router.push(`/trips/${t.id}`);
              }}
              last={i === trips.length - 1}
            />
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Tile({ icon, label, value, sub, tone }: { icon: SFSymbol; label: string; value: string; sub?: string; tone?: unknown }) {
  return (
    <View style={{ width: '48%', flexGrow: 1, backgroundColor: C.cell, borderRadius: 20, borderCurve: 'continuous', padding: 14, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SymbolView name={icon} size={13} tintColor={C.secondaryLabel} />
        <Text style={{ fontSize: 12, fontWeight: '600', color: C.secondaryLabel, textTransform: 'uppercase' }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 20, fontWeight: '700', color: (tone as string | undefined) ?? C.label }}>{value}</Text>
      {sub && (
        <Text style={{ fontSize: 12, color: C.secondaryLabel }} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}
