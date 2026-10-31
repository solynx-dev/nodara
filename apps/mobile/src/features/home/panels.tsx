import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useMe } from '@/lib/session';
import { useAddress, useTrips } from '@/lib/queries';
import { ago, clock, coords, dayLabel, firstName, formatDistance, formatDuration, formatSpeed, freshness } from '@/lib/format';
import { C } from '@/lib/theme';
import type { MemberLocation, PlaceEvent, PlaceWithMeta, Trip } from '@/lib/types';
import { Avatar, Empty, PrimaryButton } from '@/components/ui';
import { PlaceSymbol } from './placeIcons';

export type Segment = 'people' | 'places' | 'trips';

export function SegmentChips({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  const items: { key: Segment; icon: SFSymbol; label: string }[] = [
    { key: 'people', icon: 'person.2.fill', label: 'People' },
    { key: 'places', icon: 'mappin.and.ellipse', label: 'Places' },
    { key: 'trips', icon: 'car.fill', label: 'Trips' },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 14 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(it.key);
            }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <SymbolView name={it.icon} size={16} tintColor={on ? 'white' : C.label} />
            <Text style={[styles.chipText, on && { color: 'white' }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Card({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

function PersonCard({ m, isMe, ev, onPress }: { m: MemberLocation; isMe: boolean; ev?: PlaceEvent; onPress: () => void }) {
  const loc = m.location;
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  const f = freshness(loc?.recordedAt);
  const where = !loc ? (m.sharing ? 'No location yet' : 'Not sharing location') : m.currentPlace ? `At ${m.currentPlace.name}` : (address ?? coords(loc.lat, loc.lon));
  const since =
    m.currentPlace && ev?.kind === 'arrive' && ev.place.id === m.currentPlace.id
      ? `Since ${clock(ev.occurredAt)}`
      : loc
        ? f === 'live'
          ? (loc.speed ?? 0) > 1.5
            ? 'Moving now'
            : 'Live now'
          : `Updated ${ago(loc.recordedAt)}`
        : null;
  return (
    <Card onPress={onPress}>
      <View>
        <Avatar name={m.displayName} color={m.avatarColor} size={58} dim={!loc || f === 'old'} />
        {loc?.battery != null && (
          <View style={styles.battery}>
            <SymbolView name={loc.charging ? 'battery.100percent.bolt' : loc.battery <= 20 ? 'battery.25percent' : 'battery.75percent'} size={12} tintColor={loc.battery <= 15 && !loc.charging ? C.red : C.label} />
            <Text style={styles.batteryText}>{loc.battery}%</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={1}>
          {isMe ? 'You' : m.displayName}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {where}
        </Text>
        {since && <Text style={[styles.sub, (f === 'stale' || f === 'old') && { color: C.orange }]}>{since}</Text>}
      </View>
      {m.inTrip && <SymbolView name="car.fill" size={18} tintColor={C.accent} />}
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />
    </Card>
  );
}

export function PeoplePanel({
  members,
  events,
  onSelect,
  onInvite,
}: {
  members: MemberLocation[];
  events: Map<string, PlaceEvent>;
  onSelect: (id: string) => void;
  onInvite: () => void;
}) {
  const me = useMe();
  return (
    <View style={{ gap: 10, paddingHorizontal: 16 }}>
      {members.map((m) => (
        <PersonCard key={m.id} m={m} isMe={m.id === me.id} ev={events.get(m.id)} onPress={() => onSelect(m.id)} />
      ))}
      <Card onPress={onInvite}>
        <View style={[styles.roundIcon, { backgroundColor: C.accentSoft }]}>
          <SymbolView name="person.badge.plus" size={24} tintColor={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Invite someone</Text>
          <Text style={styles.sub}>Send a one-time link to join this circle</Text>
        </View>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function PlacesPanel({ places, members, onFocus, onAdd }: { places: PlaceWithMeta[]; members: MemberLocation[]; onFocus: (p: PlaceWithMeta) => void; onAdd: () => void }) {
  const byId = new Map(members.map((m) => [m.id, m]));
  return (
    <View style={{ gap: 10, paddingHorizontal: 16 }}>
      {places.length === 0 && <Empty icon="mappin.and.ellipse" title="No places yet" body="Add Home, School or Work to get arrival and departure alerts. Tip: long-press anywhere on the map." />}
      {places.map((p) => {
        const inside = p.membersInside.map((id) => byId.get(id)).filter(Boolean) as MemberLocation[];
        return (
          <Card key={p.id} onPress={() => onFocus(p)}>
            <View style={[styles.roundIcon, { backgroundColor: p.color }]}>
              <PlaceSymbol icon={p.icon} size={22} color="white" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.sub}>{inside.length ? `${inside.map((m) => firstName(m.displayName)).join(', ')} here now` : p.circleId ? 'Shared with your circle' : 'Only you'}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {inside.slice(0, 3).map((m, i) => (
                <View key={m.id} style={{ marginLeft: i ? -10 : 0 }}>
                  <Avatar name={m.displayName} color={m.avatarColor} size={28} />
                </View>
              ))}
            </View>
          </Card>
        );
      })}
      <PrimaryButton title="Add a place here" icon="plus" onPress={onAdd} />
    </View>
  );
}

// ---------------------------------------------------------------------------

function tripTitle(t: Trip) {
  return `${t.startLabel ?? 'Somewhere'} → ${t.status === 'in_progress' ? 'now' : (t.endLabel ?? 'Somewhere')}`;
}

export function TripList({ trips, onOpen }: { trips: Trip[]; onOpen: (id: string) => void }) {
  const me = useMe();
  const units = me.preferences.units;
  const groups = useMemo(() => {
    const g = new Map<string, Trip[]>();
    for (const t of trips) g.set(dayLabel(t.startedAt), [...(g.get(dayLabel(t.startedAt)) ?? []), t]);
    return [...g.entries()];
  }, [trips]);
  return (
    <View style={{ gap: 10, paddingHorizontal: 16 }}>
      {groups.map(([day, list]) => (
        <View key={day} style={{ gap: 8 }}>
          <Text style={styles.dayTitle}>{day}</Text>
          {list.map((t) => (
            <Card key={t.id} onPress={() => onOpen(t.id)}>
              <View style={[styles.roundIcon, { backgroundColor: t.status === 'in_progress' ? C.accent : C.fill }]}>
                <SymbolView name={t.mode === 'walking' ? 'figure.walk' : t.mode === 'cycling' ? 'bicycle' : 'car.fill'} size={20} tintColor={t.status === 'in_progress' ? 'white' : C.label} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {tripTitle(t)}
                </Text>
                <Text style={styles.sub}>
                  {clock(t.startedAt)} · {formatDistance(t.distanceM, units)} · {formatDuration(t.durationSec)}
                  {t.maxSpeed != null ? ` · max ${formatSpeed(t.maxSpeed, units)}` : ''}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}

export function TripsPanel({ members, onOpen }: { members: MemberLocation[]; onOpen: (id: string) => void }) {
  const me = useMe();
  const [personId, setPersonId] = useState(me.id);
  const { data: trips = [], isLoading } = useTrips(personId, 40);
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        {members.map((m) => {
          const on = m.id === personId;
          return (
            <Pressable key={m.id} onPress={() => setPersonId(m.id)} style={[styles.personChip, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]}>
              <Avatar name={m.displayName} color={m.avatarColor} size={26} />
              <Text style={styles.chipText}>{m.id === me.id ? 'You' : firstName(m.displayName)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {!isLoading && trips.length === 0 ? (
        <Empty icon="car.side" title="No trips yet" body="Trips appear automatically after travelling a few hundred metres and stopping for a few minutes." />
      ) : (
        <TripList trips={trips} onOpen={onOpen} />
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  chip: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 22, backgroundColor: C.fill },
  chipOn: { backgroundColor: C.accent },
  chipText: { fontSize: 15, fontWeight: '600', color: C.label },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 26, borderCurve: 'continuous', backgroundColor: C.cell },
  name: { fontSize: 18, fontWeight: '700', color: C.label },
  sub: { fontSize: 15, color: C.secondaryLabel },
  battery: { position: 'absolute', bottom: -6, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: C.cell, borderWidth: StyleSheet.hairlineWidth, borderColor: C.separator },
  batteryText: { fontSize: 11, fontWeight: '700', color: C.label },
  roundIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dayTitle: { fontSize: 13, fontWeight: '600', color: C.secondaryLabel, textTransform: 'uppercase', marginTop: 6, marginLeft: 4 },
  personChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4, paddingRight: 12, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.separator },
});
