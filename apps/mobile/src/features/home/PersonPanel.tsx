import { Linking, Share, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useAddress, useTodayTimeline, useTrips } from '@/lib/queries';
import { ago, clock, coords, formatDistance, formatDuration, formatSpeed, freshness } from '@/lib/format';
import { describeMember, nameOrYou } from '@/lib/status';
import { C, HEX, T } from '@/lib/theme';
import type { MemberLocation, PlaceEvent } from '@/lib/types';
import { Avatar, LiveDot, Skeleton, StatusPill, Tap } from '@/components/ui';
import { modeIcon, TripCard, tripTitle } from './panels';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Person detail inside the home sheet; the map keeps following them. */
export function PersonPanel({ m, ev, onBack, onOpenTrip }: { m: MemberLocation; ev?: PlaceEvent; onBack: () => void; onOpenTrip: (id: string) => void }) {
  const me = useMe();
  const units = me.preferences.units;
  const loc = m.location;
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  const { data: trips = [] } = useTrips(m.id, 4);
  const { data: timeline, isLoading: tlLoading } = useTodayTimeline(m.id);
  const s = describeMember(m, ev, address, units);
  const f = freshness(loc?.recordedAt);
  const moving = loc && (loc.speed ?? 0) > 1 && f === 'live';
  const isMe = m.id === me.id;

  return (
    <View style={{ paddingHorizontal: 16, gap: 14 }}>
      {/* Hero */}
      <Animated.View entering={FadeIn.duration(250)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Tap onPress={onBack} accessibilityLabel="Back to everyone" hitSlop={12} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name="chevron.left" size={16} weight="bold" tintColor={C.label} />
        </Tap>
        <Avatar name={m.displayName} color={m.avatarColor} size={60} ring={s.live} dim={!loc || s.stale} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[T.title2, { color: C.label }]} numberOfLines={1}>
              {isMe ? 'You' : m.displayName}
            </Text>
            {s.live && <LiveDot live />}
          </View>
          <StatusPill icon={s.pill.icon} text={s.pill.text} color={s.pill.color} />
        </View>
      </Animated.View>

      {/* Where */}
      <Animated.View entering={FadeInDown.delay(40).springify()} style={card}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <SymbolView name={m.currentPlace ? 'house.fill' : 'mappin.circle.fill'} size={26} tintColor={m.currentPlace?.color ?? C.accent} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[T.headline, { color: C.label }]}>{s.where}</Text>
            {s.since && <Text style={[T.subhead, { color: C.secondaryLabel }]}>{s.since}</Text>}
            {loc && m.currentPlace && address && <Text style={[T.footnote, { color: C.tertiaryLabel }]}>{address}</Text>}
            {loc && <Text style={[T.footnote, { color: C.tertiaryLabel }]}>{coords(loc.lat, loc.lon)}</Text>}
          </View>
        </View>
        {loc && s.stale && (
          <View style={{ marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,149,0,0.14)', flexDirection: 'row', gap: 10 }}>
            <SymbolView name="exclamationmark.triangle.fill" size={18} tintColor={HEX.orange} />
            <Text style={[T.footnote, { flex: 1, color: C.label, lineHeight: 18 }]}>
              This is where {isMe ? 'your phone' : `${nameOrYou(m, me.id)}'s phone`} was {ago(loc.recordedAt)} ({clock(loc.recordedAt)}). It may be off, out of signal, or not sharing in the background.
            </Text>
          </View>
        )}
      </Animated.View>

      {/* Stats */}
      {loc && (
        <Animated.View entering={FadeInDown.delay(80).springify()} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Tile
            icon="speedometer"
            label="Speed"
            value={loc.speed == null ? '—' : moving ? formatSpeed(loc.speed, units) : 'Not moving'}
            sub={moving && loc.heading != null ? `Heading ${COMPASS[Math.round(loc.heading / 45) % 8]}` : loc.speed == null ? 'Not reported' : undefined}
          />
          <Tile
            icon={loc.charging ? 'battery.100percent.bolt' : (loc.battery ?? 100) <= 20 ? 'battery.25percent' : 'battery.75percent'}
            label="Battery"
            value={loc.battery != null ? `${loc.battery}%` : '—'}
            sub={loc.charging ? 'Charging' : loc.battery == null ? 'Not reported' : loc.battery <= 15 ? 'Low' : undefined}
            tone={loc.battery != null && loc.battery <= 15 && !loc.charging ? HEX.red : undefined}
          />
          <Tile icon="clock.fill" label="Last update" value={f === 'live' ? 'Just now' : ago(loc.recordedAt)} sub={clock(loc.recordedAt)} tone={s.stale ? HEX.orange : undefined} />
          <Tile icon="scope" label="Accuracy" value={loc.accuracy != null ? `±${formatDistance(loc.accuracy, units)}` : '—'} sub={m.deviceName ?? undefined} />
        </Animated.View>
      )}

      {/* Actions */}
      {loc && (
        <Animated.View entering={FadeInDown.delay(120).springify()} style={{ flexDirection: 'row', gap: 10 }}>
          {!isMe && <Action icon="arrow.triangle.turn.up.right.diamond.fill" label="Directions" color={HEX.blue} onPress={() => void Linking.openURL(`maps://?daddr=${loc.lat},${loc.lon}`)} />}
          <Action
            icon="square.and.arrow.up"
            label="Share spot"
            color={HEX.green}
            onPress={() => void Share.share({ message: `${isMe ? 'I am' : `${m.displayName} is`} here: https://maps.apple.com/?ll=${loc.lat},${loc.lon}&q=${encodeURIComponent(s.where)}` })}
          />
        </Animated.View>
      )}

      {/* Today */}
      <Animated.View entering={FadeInDown.delay(160).springify()} style={card}>
        <Text style={[T.headline, { color: C.label, marginBottom: 10 }]}>Today</Text>
        {tlLoading ? (
          <Skeleton height={60} />
        ) : !timeline?.length ? (
          <Text style={[T.subhead, { color: C.secondaryLabel }]}>No movement recorded yet today.</Text>
        ) : (
          timeline.map((item, i) => {
            const last = i === timeline.length - 1;
            const isTrip = item.type === 'trip';
            const icon: SFSymbol = isTrip ? modeIcon(item.trip) : item.placeId ? 'house.fill' : 'mappin';
            const title = isTrip ? tripTitle(item.trip) : (item.label ?? 'Somewhere');
            const sub = isTrip
              ? `${clock(item.trip.startedAt)} · ${formatDistance(item.trip.distanceM, units)} · ${formatDuration(item.trip.durationSec)}`
              : `${clock(item.startAt)} – ${last ? 'now' : clock(item.endAt)} · ${formatDuration((Date.parse(item.endAt) - Date.parse(item.startAt)) / 1000)}`;
            return (
              <Tap key={i} disabled={!isTrip} onPress={() => isTrip && onOpenTrip(item.trip.id)} style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ alignItems: 'center', width: 30 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: isTrip ? C.accent : C.fill, alignItems: 'center', justifyContent: 'center' }}>
                    <SymbolView name={icon} size={14} tintColor={isTrip ? 'white' : C.label} />
                  </View>
                  {!last && <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: C.separator, marginVertical: 2 }} />}
                </View>
                <View style={{ flex: 1, paddingBottom: last ? 0 : 12 }}>
                  <Text style={[T.subhead, { color: C.label, fontWeight: '600' }]} numberOfLines={2}>
                    {title}
                  </Text>
                  <Text style={[T.footnote, { color: C.secondaryLabel }]}>{sub}</Text>
                </View>
                {isTrip && <SymbolView name="chevron.right" size={12} tintColor={C.tertiaryLabel} />}
              </Tap>
            );
          })
        )}
      </Animated.View>

      {trips.length > 0 && (
        <View style={{ gap: 8, marginHorizontal: -16 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.secondaryLabel, textTransform: 'uppercase', marginLeft: 20 }}>Recent trips</Text>
          <View style={{ gap: 10, paddingHorizontal: 16 }}>
            {trips.map((t, i) => (
              <TripCard key={t.id} t={t} onOpen={onOpenTrip} index={i} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const card = { backgroundColor: C.cell, borderRadius: 24, borderCurve: 'continuous' as const, padding: 16 };

function Tile({ icon, label, value, sub, tone }: { icon: SFSymbol; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <View style={{ width: '48%', flexGrow: 1, backgroundColor: C.cell, borderRadius: 22, borderCurve: 'continuous', padding: 14, gap: 4 }} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SymbolView name={icon} size={13} tintColor={C.secondaryLabel} />
        <Text style={[T.caption, { color: C.secondaryLabel, textTransform: 'uppercase' }]}>{label}</Text>
      </View>
      <Text style={[T.title3, { fontWeight: '700', color: tone ?? C.label }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub && (
        <Text style={[T.footnote, { color: C.secondaryLabel }]} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

function Action({ icon, label, color, onPress }: { icon: SFSymbol; label: string; color: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} haptic="light" style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 22, backgroundColor: C.cell }} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={24} tintColor={color} />
      <Text style={[T.footnote, { fontWeight: '600', color: C.label }]}>{label}</Text>
    </Tap>
  );
}
