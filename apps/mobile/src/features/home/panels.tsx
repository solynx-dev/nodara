import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useAddress } from '@/lib/queries';
import { ago, firstName, formatDistance } from '@/lib/format';
import { describeMember, nameOrYou } from '@/lib/status';
import { C, HEX, T } from '@/lib/theme';
import type { MemberLocation, PlaceEvent, PlaceWithMeta } from '@/lib/types';
import { Avatar, AvatarStack, Empty, LiveDot, PrimaryButton, Skeleton, StatusPill, Tap } from '@/components/ui';
import { PlaceSymbol } from './placeIcons';

export type Segment = 'people' | 'places';

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
  const detail = s.stayFor ? `Here for ${s.stayFor}` : s.since;
  return (
    <Card onPress={onPress} index={index} label={`${m.displayName}, ${s.where}${detail ? `, ${detail}` : ''}, ${s.pill.text}. Opens profile.`}>
      <View>
        <Avatar name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={58} dim={!loc || s.stale} />
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
        {detail && (
          <Text style={[T.footnote, { color: C.secondaryLabel }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
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
      {members.length > 0 && (
        <Text style={styles.hint}>Tap someone to see their drives, history and how long they&apos;ve been where they are.</Text>
      )}
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
                  {last.user.id === me.id ? 'You' : firstName(last.user.displayName)} {last.kind === 'arrive' ? 'arrived' : 'left'} {ago(last.occurredAt)}
                </Text>
              )}
              <Text style={[T.caption, { color: C.tertiaryLabel, fontWeight: '500' }]}>
                {formatDistance(p.radiusM, me.preferences.units)} radius · {p.circleId ? 'shared' : 'only you'}
              </Text>
            </View>
            <AvatarStack people={inside} size={28} max={3} />
          </Card>
        );
      })}
      <View style={{ marginTop: 6 }}>
        <PrimaryButton title="Add a place at the map centre" icon="plus" tone="plain" onPress={onAdd} />
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  list: { gap: 10, paddingHorizontal: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 26, borderCurve: 'continuous', backgroundColor: C.cell },
  battery: { position: 'absolute', bottom: -7, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: C.cell, borderWidth: StyleSheet.hairlineWidth, borderColor: C.separator },
  batteryText: { fontSize: 10, fontWeight: '800', color: C.label },
  placeBadge: { position: 'absolute', top: -2, right: -4, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  roundIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 13, color: C.tertiaryLabel, textAlign: 'center', marginTop: 8, marginHorizontal: 16, lineHeight: 18 },
});
