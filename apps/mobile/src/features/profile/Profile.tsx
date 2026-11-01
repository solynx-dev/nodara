import { useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, View, type ColorValue } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useAddress, useDayTimeline, useTripPages, useWeekTrips, type TimelineItem } from '@/lib/queries';
import { ago, clock, firstName, formatDistance, formatDuration, formatStay, freshness, weekdayShort } from '@/lib/format';
import { describeMember } from '@/lib/status';
import { C, HEX, T } from '@/lib/theme';
import type { MemberLocation, PlaceEvent } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { Avatar, Empty, LiveDot, PrimaryButton, Segmented, Skeleton, StatusPill, Tap } from '@/components/ui';
import { PlaceSymbol } from '@/features/home/placeIcons';
import { DriveList, modeIcon, WeekSummary } from '@/features/trips/Drives';

export type ProfileTab = 'drives' | 'history';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Top of the sheet while a person is open: who they are and what they're doing. Draggable. */
export function ProfileHeader({ m, ev, onBack, onEdit }: { m: MemberLocation; ev?: PlaceEvent; onBack: () => void; onEdit?: () => void }) {
  const me = useMe();
  const isMe = m.id === me.id;
  const s = describeMember(m, ev, null, me.preferences.units);
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.header}>
      <Tap onPress={onBack} accessibilityLabel="Back to everyone" hitSlop={12} style={styles.back}>
        <SymbolView name="chevron.left" size={16} weight="bold" tintColor={C.label} />
      </Tap>
      <Avatar name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={60} ring={s.live} dim={!m.location || s.stale} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[T.title2, { color: C.label, flexShrink: 1 }]} numberOfLines={1}>
            {isMe ? 'You' : m.displayName}
          </Text>
          {s.live && <LiveDot live size={9} />}
        </View>
        <StatusPill icon={s.pill.icon} text={s.pill.text} color={s.pill.color} />
      </View>
      {isMe && onEdit && (
        <Tap onPress={onEdit} style={styles.edit} accessibilityRole="button" accessibilityLabel="Edit your profile">
          <Text style={{ fontSize: 15, fontWeight: '600', color: C.accent }}>Edit</Text>
        </Tap>
      )}
    </Animated.View>
  );
}

/** Scrollable part of a person's profile. */
export function ProfileBody({ m, ev, onOpenTrip }: { m: MemberLocation; ev?: PlaceEvent; onOpenTrip: (id: string) => void }) {
  const [tab, setTab] = useState<ProfileTab>('drives');
  return (
    <View style={{ paddingHorizontal: 16, gap: 14 }}>
      <NowCard m={m} ev={ev} />
      <Segmented
        value={tab}
        onChange={setTab}
        items={[
          { key: 'drives', label: 'Drives', icon: 'car.fill' },
          { key: 'history', label: 'History', icon: 'clock.arrow.circlepath' },
        ]}
        style={{ marginTop: 4 }}
      />
      {tab === 'drives' ? <DrivesTab m={m} onOpenTrip={onOpenTrip} /> : <HistoryTab m={m} onOpenTrip={onOpenTrip} />}
    </View>
  );
}

// ---------------------------------------------------------------------------

/** Where they are, how long they've been there, and three quick facts. */
function NowCard({ m, ev }: { m: MemberLocation; ev?: PlaceEvent }) {
  const me = useMe();
  const units = me.preferences.units;
  const isMe = m.id === me.id;
  const loc = m.location;
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  const s = describeMember(m, ev, address, units);
  const f = freshness(loc?.recordedAt);
  const moving = Boolean(loc && (loc.speed ?? 0) > 1.5 && f === 'live');
  const name = isMe ? 'You' : firstName(m.displayName);

  if (!loc) {
    return (
      <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.card}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={[styles.placeIcon, { backgroundColor: C.fill }]}>
            <SymbolView name={m.sharing ? 'location.slash' : 'eye.slash.fill'} size={20} tintColor={C.secondaryLabel} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.headline, { color: C.label }]}>{s.where}</Text>
            <Text style={[T.subhead, { color: C.secondaryLabel, marginTop: 2 }]}>
              {m.sharing ? `${name} will appear here once ${isMe ? 'your' : 'their'} phone sends a location.` : `${name} turned off sharing with this circle.`}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.card}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={[styles.placeIcon, { backgroundColor: m.currentPlace?.color ?? (moving ? HEX.blue : C.accent) }]}>
          {m.currentPlace ? <PlaceSymbol icon={m.currentPlace.icon} size={20} color="white" /> : <SymbolView name={moving ? 'car.fill' : 'mappin'} size={20} tintColor="white" />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.title3, { color: C.label }]} numberOfLines={2}>
            {s.where}
          </Text>
          {m.currentPlace && address && (
            <Text style={[T.footnote, { color: C.secondaryLabel }]} numberOfLines={1}>
              {address}
            </Text>
          )}
        </View>
      </View>

      {/* How long they've been here: the thing people actually want to know. */}
      {s.stayFor && m.stay ? (
        <View style={styles.stay}>
          <SymbolView name="hourglass" size={15} tintColor={C.accent} />
          <Text style={[T.subhead, { color: C.label, flex: 1 }]}>
            Here for <Text style={{ fontWeight: '700' }}>{s.stayFor}</Text>
            <Text style={{ color: C.secondaryLabel }}> · since {new Date(m.stay.since).toDateString() === new Date().toDateString() ? clock(m.stay.since) : new Date(m.stay.since).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
          </Text>
        </View>
      ) : moving ? (
        <View style={styles.stay}>
          <SymbolView name="location.north.line.fill" size={15} tintColor={HEX.blue} />
          <Text style={[T.subhead, { color: C.label, flex: 1 }]}>
            On the move{loc.heading != null ? `, heading ${COMPASS[Math.round(loc.heading / 45) % 8]}` : ''}
          </Text>
        </View>
      ) : s.since ? (
        <View style={styles.stay}>
          <SymbolView name="arrow.uturn.right" size={15} tintColor={C.secondaryLabel} />
          <Text style={[T.subhead, { color: C.label, flex: 1 }]}>{s.since}</Text>
        </View>
      ) : null}

      <View style={styles.facts}>
        <Fact
          icon={loc.charging ? 'battery.100percent.bolt' : (loc.battery ?? 100) <= 20 ? 'battery.25percent' : 'battery.75percent'}
          value={loc.battery != null ? `${loc.battery}%` : '—'}
          label={loc.charging ? 'Charging' : 'Battery'}
          tone={loc.battery != null && loc.battery <= 15 && !loc.charging ? HEX.red : undefined}
        />
        <View style={styles.factSep} />
        <Fact icon="clock" value={f === 'live' ? 'Now' : ago(loc.recordedAt).replace(' ago', '')} label={f === 'live' ? 'Updated' : 'Since update'} tone={s.stale ? HEX.orange : undefined} />
        <View style={styles.factSep} />
        <Fact icon="scope" value={loc.accuracy != null ? `±${formatDistance(loc.accuracy, units)}` : '—'} label="Accuracy" />
      </View>

      {s.stale && (
        <View style={styles.warn}>
          <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor={HEX.orange} />
          <Text style={[T.footnote, { flex: 1, color: C.label, lineHeight: 18 }]}>
            Last known location from {ago(loc.recordedAt)} ({clock(loc.recordedAt)}). {isMe ? 'Your' : `${name}'s`} phone may be off, out of signal, or not sharing in the background.
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {!isMe && <Action icon="arrow.triangle.turn.up.right.diamond.fill" label="Directions" color={HEX.blue} onPress={() => void Linking.openURL(`maps://?daddr=${loc.lat},${loc.lon}`)} />}
        <Action
          icon="square.and.arrow.up"
          label={isMe ? 'Share my spot' : 'Share'}
          color={HEX.green}
          onPress={() => void Share.share({ message: `${isMe ? "I'm" : `${m.displayName} is`} here: https://maps.apple.com/?ll=${loc.lat},${loc.lon}&q=${encodeURIComponent(s.where)}` })}
        />
      </View>
    </Animated.View>
  );
}

function Fact({ icon, value, label, tone }: { icon: SFSymbol; value: string; label: string; tone?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <SymbolView name={icon} size={13} tintColor={tone ?? C.secondaryLabel} />
        <Text style={[T.headline, { color: tone ?? C.label }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
      <Text style={[T.caption, { color: C.tertiaryLabel, fontWeight: '500' }]}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, color, onPress }: { icon: SFSymbol; label: string; color: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} haptic="light" style={styles.action} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={17} tintColor={color} />
      <Text style={[T.subhead, { fontWeight: '600', color: C.label }]}>{label}</Text>
    </Tap>
  );
}

// ---------------------------------------------------------------------------

const notShared = (e: unknown) => e instanceof ApiError && e.status === 404;

function DrivesTab({ m, onOpenTrip }: { m: MemberLocation; onOpenTrip: (id: string) => void }) {
  const me = useMe();
  const name = m.id === me.id ? 'you' : firstName(m.displayName);
  const week = useWeekTrips(m.id);
  const pages = useTripPages(m.id);
  const trips = pages.data?.pages.flat() ?? [];

  if (pages.isLoading) {
    return (
      <View style={{ gap: 10 }}>
        <Skeleton height={190} />
        <Skeleton height={110} />
        <Skeleton height={110} />
      </View>
    );
  }
  if (pages.error) {
    return notShared(pages.error) ? (
      <Empty icon="lock.fill" title="Drives aren't shared" body={`The circle you share with ${name} keeps drives private. A circle admin can change this in the circle's settings.`} />
    ) : (
      <Empty icon="wifi.exclamationmark" title="Couldn't load drives" body={(pages.error as Error).message} action={<PrimaryButton title="Try again" tone="plain" onPress={() => void pages.refetch()} />} />
    );
  }
  if (!trips.length) {
    return <Empty icon="car.side" title="No drives yet" body={`Drives appear automatically after ${m.id === me.id ? 'you travel' : `${name} travels`} a few hundred metres and then stop for a few minutes.`} />;
  }
  return (
    <View style={{ gap: 16 }}>
      {!!week.data?.length && <WeekSummary trips={week.data} />}
      <DriveList trips={trips} onOpen={onOpenTrip} />
      {pages.hasNextPage && (
        <PrimaryButton title={pages.isFetchingNextPage ? 'Loading…' : 'Show older drives'} tone="plain" icon="clock.arrow.circlepath" loading={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} />
      )}
      {!pages.hasNextPage && trips.length > 3 && <Text style={[T.footnote, { color: C.tertiaryLabel, textAlign: 'center' }]}>That&apos;s every drive {name === 'you' ? 'you have' : `${name} has`} shared.</Text>}
    </View>
  );
}

function HistoryTab({ m, onOpenTrip }: { m: MemberLocation; onOpenTrip: (id: string) => void }) {
  const me = useMe();
  const units = me.preferences.units;
  const [daysAgo, setDaysAgo] = useState(0);
  const { data: items, isLoading, error } = useDayTimeline(m.id, daysAgo);
  const name = m.id === me.id ? 'you' : firstName(m.displayName);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return { i, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : weekdayShort(d), sub: d.getDate() };
  });

  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} style={{ marginHorizontal: -16 }}>
        {days.map((d) => {
          const on = d.i === daysAgo;
          return (
            <Tap key={d.i} onPress={() => setDaysAgo(d.i)} style={[styles.dayChip, on && { backgroundColor: C.accent }]} accessibilityState={{ selected: on }} accessibilityLabel={d.label}>
              <Text style={[styles.dayChipText, on && { color: 'white' }]}>{d.label}</Text>
            </Tap>
          );
        })}
      </ScrollView>
      {isLoading ? (
        <Skeleton height={220} />
      ) : error ? (
        notShared(error) ? (
          <Empty icon="lock.fill" title="History isn't shared" body={`The circle you share with ${name} keeps location history private.`} />
        ) : (
          <Empty icon="wifi.exclamationmark" title="Couldn't load history" body={(error as Error).message} />
        )
      ) : !items?.length ? (
        <Empty icon="calendar" title="Nothing recorded" body={daysAgo === 0 ? `No movement recorded yet today.` : `No location history for this day.`} />
      ) : (
        <Animated.View key={daysAgo} entering={FadeIn.duration(200)} style={styles.card}>
          {items.map((item, i) => (
            <TimelineRow key={i} item={item} last={i === items.length - 1} current={daysAgo === 0 && i === items.length - 1} units={units} onOpenTrip={onOpenTrip} />
          ))}
        </Animated.View>
      )}
    </View>
  );
}

function TimelineRow({ item, last, current, units, onOpenTrip }: { item: TimelineItem; last: boolean; current: boolean; units: 'metric' | 'imperial'; onOpenTrip: (id: string) => void }) {
  if (item.type === 'trip') {
    const t = item.trip;
    return (
      <Tap onPress={() => onOpenTrip(t.id)} style={styles.tlRow} accessibilityRole="button" accessibilityLabel={`Trip, ${formatDistance(t.distanceM, units)}`}>
        <Rail icon={modeIcon(t)} color={C.accent} last={last} />
        <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
          <Text style={[T.subhead, { color: C.label, fontWeight: '600' }]}>
            {t.mode === 'walking' ? 'Walked' : t.mode === 'cycling' ? 'Rode' : 'Drove'} {formatDistance(t.distanceM, units)}
          </Text>
          <Text style={[T.footnote, { color: C.secondaryLabel }]}>
            {clock(t.startedAt)}
            {t.endedAt ? `–${clock(t.endedAt)}` : ' – now'} · {formatDuration(t.durationSec)}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiaryLabel} />
      </Tap>
    );
  }
  const dur = (Date.parse(item.endAt) - Date.parse(item.startAt)) / 1000;
  return (
    <View style={styles.tlRow}>
      <Rail icon={item.placeId ? 'house.fill' : 'mappin'} color={current ? HEX.green : C.fillStrong} iconColor={current ? 'white' : C.label} last={last} />
      <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
        <Text style={[T.subhead, { color: C.label, fontWeight: '600' }]} numberOfLines={2}>
          {item.label ?? 'Somewhere'}
        </Text>
        <Text style={[T.footnote, { color: C.secondaryLabel }]}>
          {clock(item.startAt)} – {current ? 'now' : clock(item.endAt)} · {formatStay(dur)}
        </Text>
      </View>
    </View>
  );
}

function Rail({ icon, color, iconColor = 'white', last }: { icon: SFSymbol; color: ColorValue; iconColor?: ColorValue; last: boolean }) {
  return (
    <View style={{ alignItems: 'center', width: 30 }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <SymbolView name={icon} size={14} tintColor={iconColor} />
      </View>
      {!last && <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: C.separator, marginVertical: 3 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  edit: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.cell, borderRadius: 24, borderCurve: 'continuous', padding: 16, gap: 14 },
  placeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stay: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: C.fill },
  facts: { flexDirection: 'row', alignItems: 'center' },
  factSep: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: C.separator },
  warn: { padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,149,0,0.14)', flexDirection: 'row', gap: 10 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 23, backgroundColor: C.fill },
  dayChip: { paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: C.cell, alignItems: 'center', justifyContent: 'center' },
  dayChipText: { fontSize: 15, fontWeight: '600', color: C.label },
  tlRow: { flexDirection: 'row', gap: 12 },
});
