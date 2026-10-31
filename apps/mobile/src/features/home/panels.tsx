import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useAddress, useTrips } from '@/lib/queries';
import { ago, clock, dayLabel, firstName, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { describeMember, nameOrYou } from '@/lib/status';
import { C, HEX, T } from '@/lib/theme';
import type { MemberLocation, PlaceEvent, PlaceWithMeta, Trip } from '@/lib/types';
import { Avatar, Empty, LiveDot, PrimaryButton, Skeleton, StatusPill, Tap } from '@/components/ui';
import { PlaceSymbol } from './placeIcons';

export type Segment = 'people' | 'places' | 'trips';

const SEGMENTS: { key: Segment; icon: SFSymbol; label: string }[] = [
  { key: 'people', icon: 'person.2.fill', label: 'People' },
  { key: 'places', icon: 'mappin.and.ellipse', label: 'Places' },
  { key: 'trips', icon: 'car.fill', label: 'Trips' },
];

/** Segmented control with a sliding selection pill. */
export function SegmentControl({ value, onChange, counts }: { value: Segment; onChange: (s: Segment) => void; counts?: Partial<Record<Segment, number>> }) {
  const [width, setWidth] = useState(0);
  const i = SEGMENTS.findIndex((s) => s.key === value);
  const seg = width / SEGMENTS.length;
  const pill = useAnimatedStyle(() => ({ width: seg - 4, transform: [{ translateX: withSpring(i * seg + 2, { damping: 20, stiffness: 260 }) }] }), [i, seg]);
  return (
    <View style={styles.segment} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {width > 0 && <Animated.View style={[styles.segmentPill, pill]} />}
      {SEGMENTS.map((s) => {
        const on = s.key === value;
        return (
          <Tap key={s.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(s.key)} style={styles.segmentItem} scaleTo={0.95}>
            <SymbolView name={s.icon} size={15} tintColor={on ? C.accent : C.secondaryLabel} />
            <Text style={[styles.segmentText, on && { color: C.label }]}>{s.label}</Text>
            {!!counts?.[s.key] && <Text style={styles.segmentCount}>{counts[s.key]}</Text>}
          </Tap>
        );
      })}
    </View>
  );
}

function Card({ children, onPress, index = 0, label }: { children: React.ReactNode; onPress?: () => void; index?: number; label?: string }) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 40).springify().damping(18)} layout={LinearTransition.springify()}>
      <Tap onPress={onPress} disabled={!onPress} style={styles.card} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}>
        {children}
      </Tap>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------

function BatteryBadge({ level, charging }: { level: number; charging: boolean | null }) {
  const low = level <= 15 && !charging;
  return (
    <View style={styles.battery}>
      <SymbolView name={charging ? 'battery.100percent.bolt' : level <= 20 ? 'battery.25percent' : level <= 60 ? 'battery.50percent' : 'battery.100percent'} size={12} tintColor={low ? HEX.red : C.label} />
      <Text style={[styles.batteryText, low && { color: HEX.red }]} allowFontScaling={false}>
        {level}%
      </Text>
    </View>
  );
}

function PersonCard({ m, ev, onPress, index }: { m: MemberLocation; ev?: PlaceEvent; onPress: () => void; index: number }) {
  const me = useMe();
  const loc = m.location;
  const { data: address } = useAddress(m.currentPlace ? undefined : loc?.lat, m.currentPlace ? undefined : loc?.lon);
  const s = describeMember(m, ev, address, me.preferences.units);
  return (
    <Card onPress={onPress} index={index} label={`${m.displayName}, ${s.where}, ${s.pill.text}`}>
      <View>
        <Avatar name={m.displayName} color={m.avatarColor} size={58} dim={!loc || s.stale} />
        {loc?.battery != null && <BatteryBadge level={loc.battery} charging={loc.charging} />}
        {m.currentPlace && (
          <View style={[styles.placeBadge, { backgroundColor: m.currentPlace.color }]}>
            <PlaceSymbol icon={m.currentPlace.icon} size={10} color="white" />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[T.headline, { color: C.label, fontSize: 18 }]} numberOfLines={1}>
            {nameOrYou(m, me.id)}
          </Text>
          {s.live && <LiveDot live size={8} />}
        </View>
        <Text style={[T.subhead, { color: C.label }]} numberOfLines={2}>
          {s.where}
        </Text>
        {s.since && <Text style={[T.footnote, { color: C.secondaryLabel }]}>{s.since}</Text>}
        <StatusPill icon={s.pill.icon} text={s.pill.text} color={s.pill.color} />
      </View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />
    </Card>
  );
}

export function PeoplePanel({ members, events, loading, onSelect, onInvite }: { members: MemberLocation[]; events: Map<string, PlaceEvent>; loading: boolean; onSelect: (id: string) => void; onInvite: () => void }) {
  if (loading && !members.length) {
    return (
      <View style={styles.list}>
        <Skeleton height={104} />
        <Skeleton height={104} />
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {members.map((m, i) => (
        <PersonCard key={m.id} m={m} ev={events.get(m.id)} index={i} onPress={() => onSelect(m.id)} />
      ))}
      <Card onPress={onInvite} index={members.length} label="Invite someone">
        <View style={[styles.roundIcon, { backgroundColor: C.accentSoft }]}>
          <SymbolView name="person.badge.plus" size={24} tintColor={C.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.headline, { color: C.label }]}>Invite someone</Text>
          <Text style={[T.footnote, { color: C.secondaryLabel }]}>Send a one-time link. It expires in 3 days.</Text>
        </View>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function PlacesPanel({
  places,
  members,
  events,
  onFocus,
  onAdd,
}: {
  places: PlaceWithMeta[];
  members: MemberLocation[];
  events: PlaceEvent[];
  onFocus: (p: PlaceWithMeta) => void;
  onAdd: () => void;
}) {
  const me = useMe();
  const byId = new Map(members.map((m) => [m.id, m]));
  const lastByPlace = new Map<string, PlaceEvent>();
  for (const e of events) if (!lastByPlace.has(e.place.id)) lastByPlace.set(e.place.id, e);
  return (
    <View style={styles.list}>
      {places.length === 0 && (
        <Empty icon="mappin.and.ellipse" title="No places yet" body="Save Home, School or Work to see who's there and get arrival and departure alerts. Tip: long-press anywhere on the map." />
      )}
      {places.map((p, i) => {
        const inside = p.membersInside.map((id) => byId.get(id)).filter(Boolean) as MemberLocation[];
        const last = lastByPlace.get(p.id);
        return (
          <Card key={p.id} onPress={() => onFocus(p)} index={i} label={p.name}>
            <View style={[styles.roundIcon, { backgroundColor: p.color }]}>
              <PlaceSymbol icon={p.icon} size={22} color="white" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[T.headline, { color: C.label }]}>{p.name}</Text>
              <Text style={[T.footnote, { color: inside.length ? HEX.green : C.secondaryLabel }]} numberOfLines={2}>
                {inside.length ? `${inside.map((m) => nameOrYou(m, me.id)).join(', ')} ${inside.length === 1 && inside[0]!.id !== me.id ? 'is' : 'are'} here` : 'Nobody here right now'}
              </Text>
              {last && (
                <Text style={[T.footnote, { color: C.tertiaryLabel }]} numberOfLines={1}>
                  {firstName(last.user.displayName)} {last.kind === 'arrive' ? 'arrived' : 'left'} {ago(last.occurredAt)}
                </Text>
              )}
              <Text style={[T.caption, { color: C.tertiaryLabel, fontWeight: '500' }]}>
                {formatDistance(p.radiusM, me.preferences.units)} radius · {p.circleId ? 'shared' : 'only you'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {inside.slice(0, 3).map((m, j) => (
                <View key={m.id} style={{ marginLeft: j ? -10 : 0, borderRadius: 16, borderWidth: 2, borderColor: C.cell as string }}>
                  <Avatar name={m.displayName} color={m.avatarColor} size={28} />
                </View>
              ))}
            </View>
          </Card>
        );
      })}
      <View style={{ marginTop: 6 }}>
        <PrimaryButton title="Add a place at the map centre" icon="plus" tone="plain" onPress={onAdd} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function tripTitle(t: Trip) {
  return `${t.startLabel ?? 'Somewhere'} → ${t.status === 'in_progress' ? 'now' : (t.endLabel ?? 'Somewhere')}`;
}

export const modeIcon = (t: Trip): SFSymbol => (t.mode === 'walking' ? 'figure.walk' : t.mode === 'cycling' ? 'bicycle' : 'car.fill');

export function TripCard({ t, onOpen, index = 0 }: { t: Trip; onOpen: (id: string) => void; index?: number }) {
  const me = useMe();
  const units = me.preferences.units;
  const liveTrip = t.status === 'in_progress';
  return (
    <Card onPress={() => onOpen(t.id)} index={index} label={tripTitle(t)}>
      <View style={[styles.roundIcon, { backgroundColor: liveTrip ? C.accent : C.fill }]}>
        <SymbolView name={modeIcon(t)} size={20} tintColor={liveTrip ? 'white' : C.label} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[T.headline, { color: C.label }]} numberOfLines={2}>
          {tripTitle(t)}
        </Text>
        <Text style={[T.footnote, { color: C.secondaryLabel }]}>
          {clock(t.startedAt)}
          {t.endedAt ? `–${clock(t.endedAt)}` : ''} · {formatDuration(t.durationSec)}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill icon="road.lanes" text={formatDistance(t.distanceM, units)} color={HEX.blue} />
          {t.maxSpeed != null && <StatusPill icon="gauge.with.dots.needle.67percent" text={`max ${formatSpeed(t.maxSpeed, units)}`} color={HEX.gray} />}
          {liveTrip && <StatusPill icon="dot.radiowaves.left.and.right" text="Live" color={HEX.green} />}
        </View>
      </View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />
    </Card>
  );
}

export function TripList({ trips, onOpen }: { trips: Trip[]; onOpen: (id: string) => void }) {
  const groups = useMemo(() => {
    const g = new Map<string, Trip[]>();
    for (const t of trips) g.set(dayLabel(t.startedAt), [...(g.get(dayLabel(t.startedAt)) ?? []), t]);
    return [...g.entries()];
  }, [trips]);
  let n = 0;
  return (
    <View style={styles.list}>
      {groups.map(([day, list]) => (
        <View key={day} style={{ gap: 8 }}>
          <Text style={styles.dayTitle}>{day}</Text>
          {list.map((t) => (
            <TripCard key={t.id} t={t} onOpen={onOpen} index={n++} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function TripsPanel({ members, onOpen }: { members: MemberLocation[]; onOpen: (id: string) => void }) {
  const me = useMe();
  const units = me.preferences.units;
  const [personId, setPersonId] = useState(me.id);
  const { data: trips = [], isLoading } = useTrips(personId, 40);
  const week = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const w = trips.filter((t) => new Date(t.startedAt) > since);
    return { count: w.length, distance: w.reduce((s, t) => s + t.distanceM, 0), time: w.reduce((s, t) => s + t.durationSec, 0) };
  }, [trips]);
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        {members.map((m) => {
          const on = m.id === personId;
          return (
            <Tap key={m.id} onPress={() => setPersonId(m.id)} style={[styles.personChip, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]} accessibilityState={{ selected: on }}>
              <Avatar name={m.displayName} color={m.avatarColor} size={26} />
              <Text style={[T.subhead, { fontWeight: '600', color: C.label }]}>{nameOrYou(m, me.id)}</Text>
            </Tap>
          );
        })}
      </ScrollView>
      {isLoading ? (
        <View style={styles.list}>
          <Skeleton height={80} />
          <Skeleton height={96} />
        </View>
      ) : trips.length === 0 ? (
        <Empty icon="car.side" title="No trips yet" body="Trips appear automatically after travelling a few hundred metres and then stopping for a few minutes." />
      ) : (
        <>
          <Animated.View entering={FadeInDown.springify()} style={[styles.card, styles.weekCard]}>
            <WeekStat label="Trips" value={String(week.count)} />
            <WeekStat label="Distance" value={formatDistance(week.distance, units)} />
            <WeekStat label="Travelling" value={formatDuration(week.time)} />
          </Animated.View>
          <TripList trips={trips} onOpen={onOpen} />
        </>
      )}
    </View>
  );
}

function WeekStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={[T.title3, { color: C.label, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[T.caption, { color: C.secondaryLabel }]}>{label} · 7 days</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  list: { gap: 10, paddingHorizontal: 16 },
  segment: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, height: 40, borderRadius: 20, backgroundColor: C.fill, padding: 2 },
  segmentPill: { position: 'absolute', top: 2, bottom: 2, borderRadius: 18, backgroundColor: C.cell, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segmentText: { fontSize: 14, fontWeight: '600', color: C.secondaryLabel },
  segmentCount: { fontSize: 12, fontWeight: '700', color: C.tertiaryLabel },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 26, borderCurve: 'continuous', backgroundColor: C.cell },
  weekCard: { marginHorizontal: 16, marginBottom: 12, paddingVertical: 16 },
  battery: { position: 'absolute', bottom: -7, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: C.cell, borderWidth: StyleSheet.hairlineWidth, borderColor: C.separator },
  batteryText: { fontSize: 10, fontWeight: '800', color: C.label },
  placeBadge: { position: 'absolute', top: -2, right: -4, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  roundIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dayTitle: { fontSize: 13, fontWeight: '700', color: C.secondaryLabel, textTransform: 'uppercase', marginTop: 8, marginLeft: 4 },
  personChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4, paddingRight: 12, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.separator },
});
