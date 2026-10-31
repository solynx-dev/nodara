import { Linking, Pressable, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useAddress, useTrips } from '@/lib/queries';
import { ago, clock, coords, formatDistance, formatSpeed, freshness } from '@/lib/format';
import { C } from '@/lib/theme';
import type { MemberLocation, PlaceEvent } from '@/lib/types';
import { Avatar } from '@/components/ui';
import { TripList } from './panels';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Person detail, shown inside the home sheet (the map keeps following them). */
export function PersonPanel({ m, ev, onBack, onOpenTrip }: { m: MemberLocation; ev?: PlaceEvent; onBack: () => void; onOpenTrip: (id: string) => void }) {
  const me = useMe();
  const units = me.preferences.units;
  const loc = m.location;
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  const { data: trips = [] } = useTrips(m.id, 5);
  const f = freshness(loc?.recordedAt);
  const moving = loc && (loc.speed ?? 0) > 1 && f === 'live';
  const where = !loc ? (m.sharing ? 'No location yet' : 'Not sharing location') : m.currentPlace ? `At ${m.currentPlace.name}` : (address ?? coords(loc.lat, loc.lon));
  const since = m.currentPlace && ev?.kind === 'arrive' && ev.place.id === m.currentPlace.id ? ` · since ${clock(ev.occurredAt)}` : '';

  return (
    <View style={{ paddingHorizontal: 16, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable onPress={onBack} accessibilityLabel="Back to everyone" hitSlop={12} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name="chevron.left" size={16} weight="semibold" tintColor={C.label} />
        </Pressable>
        <Avatar name={m.displayName} color={m.avatarColor} size={56} ring={f === 'live'} dim={f === 'old'} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: C.label }} numberOfLines={1}>
            {m.id === me.id ? 'You' : m.displayName}
          </Text>
          <Text style={{ fontSize: 15, color: C.secondaryLabel }} numberOfLines={2}>
            {where}
            {since}
          </Text>
        </View>
      </View>

      {loc && (f === 'stale' || f === 'old') && (
        <View style={{ padding: 14, borderRadius: 20, backgroundColor: 'rgba(255,149,0,0.14)', flexDirection: 'row', gap: 10 }}>
          <SymbolView name="clock.badge.exclamationmark" size={20} tintColor={C.orange} />
          <Text style={{ flex: 1, color: C.label, fontSize: 14, lineHeight: 19 }}>
            Last known location from {ago(loc.recordedAt)} ({clock(loc.recordedAt)}). Their phone may be offline or not sharing in the background.
          </Text>
        </View>
      )}

      {loc && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Tile icon="dot.radiowaves.left.and.right" label="Updated" value={f === 'live' ? 'Live' : ago(loc.recordedAt)} tone={f === 'live' ? C.green : f === 'recent' ? undefined : C.orange} />
          <Tile icon="speedometer" label="Speed" value={loc.speed == null ? '—' : moving ? formatSpeed(loc.speed, units) : 'Still'} sub={moving && loc.heading != null ? `Heading ${COMPASS[Math.round(loc.heading / 45) % 8]}` : undefined} />
          <Tile icon={loc.charging ? 'battery.100percent.bolt' : (loc.battery ?? 100) <= 20 ? 'battery.25percent' : 'battery.75percent'} label="Battery" value={loc.battery != null ? `${loc.battery}%` : '—'} tone={loc.battery != null && loc.battery <= 15 && !loc.charging ? C.red : undefined} />
          <Tile icon="scope" label="Accuracy" value={loc.accuracy != null ? `±${formatDistance(loc.accuracy, units)}` : '—'} sub={m.deviceName ?? undefined} />
        </View>
      )}

      {loc && m.id !== me.id && (
        <Pressable
          onPress={() => void Linking.openURL(`maps://?daddr=${loc.lat},${loc.lon}`)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: C.cell, opacity: pressed ? 0.7 : 1 })}
        >
          <SymbolView name="arrow.triangle.turn.up.right.diamond.fill" size={26} tintColor="#007AFF" />
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: C.label }}>Directions in Apple Maps</Text>
          <SymbolView name="arrow.up.right" size={13} tintColor={C.tertiaryLabel} />
        </Pressable>
      )}

      {trips.length > 0 && (
        <View style={{ marginHorizontal: -16 }}>
          <TripList trips={trips} onOpen={onOpenTrip} />
        </View>
      )}
    </View>
  );
}

function Tile({ icon, label, value, sub, tone }: { icon: SFSymbol; label: string; value: string; sub?: string; tone?: unknown }) {
  return (
    <View style={{ width: '48%', flexGrow: 1, backgroundColor: C.cell, borderRadius: 22, borderCurve: 'continuous', padding: 14, gap: 4 }}>
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
