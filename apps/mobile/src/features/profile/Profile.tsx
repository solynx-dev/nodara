import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { appear } from '@/lib/motion';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useAddress, useDayTimeline, usePlaces, useTripPages, useWeekTrips, type TimelineItem } from '@/lib/queries';
import { ago, clock, firstName, formatDistance, formatStay, freshness, weekdayShort } from '@/lib/format';
import { BUBBLE_COLOR, bubbleArea, describeMember } from '@/lib/status';
import { driveState } from '@/lib/driving';
import { C, HEX, T } from '@/lib/theme';
import type { MemberLocation, PlaceEvent } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { Avatar, Empty, LiveDot, PrimaryButton, Segmented, Skeleton, StatusPill, Tap } from '@/components/ui';
import { PlaceSymbol } from '@/features/home/placeIcons';
import { DriveList, TripMapCard, WeekSummary } from '@/features/trips/Drives';
import { useLocationRefresh } from '@/lib/refresh';
import { DrivingWeekCard } from '@/features/driving/components';

export type ProfileTab = 'drives' | 'history';

const stoppedFor = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Top of the sheet while a person is open: who they are and what they're doing. Draggable. */
export function ProfileHeader({ m, ev, onBack, onEdit }: { m: MemberLocation; ev?: PlaceEvent; onBack: () => void; onEdit?: () => void }) {
  const me = useMe();
  const isMe = m.id === me.id;
  const s = describeMember(m, ev, null, me.preferences.units);
  return (
    <Animated.View entering={appear} style={styles.header}>
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
        <StatusPill icon={s.pill.icon} text={s.pill.text} color={s.pill.color} textColor={s.pill.textColor} />
      </View>
      {isMe && onEdit && (
        <Tap onPress={onEdit} style={styles.edit} accessibilityRole="button" accessibilityLabel="Edit your profile">
          <Text style={{ fontSize: 15, fontWeight: '600', color: C.accentText }}>Edit</Text>
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
  const drive = driveState(m);
  const moving = Boolean(drive ? !drive.stopped : loc && (loc.speed ?? 0) > 1.5 && f === 'live');
  const driving = Boolean(drive);
  const name = isMe ? 'You' : firstName(m.displayName);

  // In a bubble: a general area only, plus battery and when their phone last checked in.
  if (!loc && m.bubble) {
    const b = m.bubble;
    return (
      <Animated.View entering={appear} style={styles.card}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={[styles.placeIcon, { backgroundColor: BUBBLE_COLOR }]}>
            <SymbolView name="circle.dashed" size={20} weight="bold" tintColor="white" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[T.title3, { color: C.label }]} numberOfLines={2}>
              {s.where}
            </Text>
            <Text style={[T.footnote, { color: C.secondaryLabel }]}>
              {name} is sharing only a general area until {clock(b.endsAt)}.
            </Text>
          </View>
        </View>
        <View style={styles.facts}>
          <Fact
            icon={b.charging ? 'battery.100percent.bolt' : (b.battery ?? 100) <= 20 ? 'battery.25percent' : 'battery.75percent'}
            value={b.battery != null ? `${b.battery}%` : '—'}
            label={b.charging ? 'Charging' : 'Battery'}
            tone={b.battery != null && b.battery <= 15 && !b.charging ? HEX.red : undefined}
          />
          <View style={styles.factSep} />
          <Fact icon="clock" value={b.seenAt ? ago(b.seenAt).replace(' ago', '') : '—'} label="Last check-in" />
          <View style={styles.factSep} />
          <Fact icon="circle.dashed" value={formatDistance(b.radiusM, units)} label="Area" />
        </View>
        <Text style={[T.footnote, { color: C.secondaryLabel, lineHeight: 18 }]}>
          Places, trips and drives from while the bubble is on stay private. It ends early if {name} leaves the area.
        </Text>
      </Animated.View>
    );
  }

  if (!loc) {
    return (
      <Animated.View entering={appear} style={styles.card}>
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
    <Animated.View entering={appear} style={styles.card}>
      {isMe && m.bubble && (
        <Tap onPress={() => router.push('/bubble')} style={styles.bubbleBanner} accessibilityRole="button" accessibilityLabel="Manage your bubble">
          <SymbolView name="circle.dashed.inset.filled" size={18} tintColor={BUBBLE_COLOR} />
          <Text style={[T.footnote, { color: C.label, flex: 1, lineHeight: 18 }]}>
            <Text style={{ fontWeight: '700' }}>Bubble on until {clock(m.bubble.endsAt)}.</Text> Your circles see “{bubbleArea(m.bubble, units)}”.
          </Text>
          <SymbolView name="chevron.right" size={12} weight="semibold" tintColor={C.tertiaryLabel} />
        </Tap>
      )}
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={[styles.placeIcon, { backgroundColor: m.currentPlace?.color ?? (moving || driving ? HEX.blue : C.accent) }]}>
          {m.currentPlace ? <PlaceSymbol icon={m.currentPlace.icon} size={20} color="white" /> : <SymbolView name={moving || driving ? 'car.fill' : 'mappin'} size={20} tintColor="white" />}
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
          <SymbolView name="hourglass" size={15} tintColor={C.accentText} />
          <Text style={[T.subhead, { color: C.label, flex: 1 }]}>
            Here for <Text style={{ fontWeight: '700' }}>{s.stayFor}</Text>
            <Text style={{ color: C.secondaryLabel }}> · since {new Date(m.stay.since).toDateString() === new Date().toDateString() ? clock(m.stay.since) : new Date(m.stay.since).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
          </Text>
        </View>
      ) : drive?.stopped ? (
        <View style={styles.stay}>
          <SymbolView name="pause.circle.fill" size={15} tintColor={HEX.blue} />
          <Text style={[T.subhead, { color: C.label, flex: 1 }]}>
            Stopped for {stoppedFor(drive.stoppedForMs)}, still on a drive
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
      <DrivingWeekCard userId={m.id} onOpenReport={() => router.push({ pathname: '/driving', params: { user: m.id } })} />
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
  const [daysAgo, setDaysAgo] = useState(0);
  const { data: items, isLoading, error } = useDayTimeline(m.id, daysAgo);
  const name = m.id === me.id ? 'you' : firstName(m.displayName);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return { i, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : weekdayShort(d), sub: d.getDate() };
  });
  // Newest first, like a feed: what's happening now is at the top.
  const feed = items ? [...items].reverse() : [];

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
        <View style={{ gap: 12 }}>
          <Skeleton height={130} />
          <Skeleton height={290} />
        </View>
      ) : error ? (
        notShared(error) ? (
          <Empty icon="lock.fill" title="History isn't shared" body={`The circle you share with ${name} keeps location history private.`} />
        ) : (
          <Empty icon="wifi.exclamationmark" title="Couldn't load history" body={(error as Error).message} />
        )
      ) : !feed.length ? (
        <Empty icon="calendar" title="Nothing recorded" body={daysAgo === 0 ? `No movement recorded yet today.` : `No location history for this day.`} />
      ) : (
        <Animated.View key={daysAgo} entering={appear} style={{ gap: 12 }}>
          {feed.map((item, i) =>
            item.type === 'trip' ? (
              <TripMapCard key={item.trip.id} t={item.trip} onOpen={onOpenTrip} />
            ) : (
              <StayCard key={item.startAt} item={item} m={m} current={daysAgo === 0 && i === 0} />
            ),
          )}
        </Animated.View>
      )}
    </View>
  );
}

/** A stay on the day's timeline: where, from when to when, and for how long. */
function StayCard({ item, m, current }: { item: Extract<TimelineItem, { type: 'stay' }>; m: MemberLocation; current: boolean }) {
  const me = useMe();
  const { data: places = [] } = usePlaces();
  const place = item.placeId ? places.find((p) => p.id === item.placeId) : undefined;
  const refresher = useLocationRefresh(current && m.id !== me.id ? m : null);
  const dur = (Date.parse(item.endAt) - Date.parse(item.startAt)) / 1000;
  const title = item.label ? `${place || item.placeId ? 'At' : 'Near'} ${item.label}` : 'Somewhere';
  return (
    <View style={styles.stayCard} accessible accessibilityLabel={`${title}, ${clock(item.startAt)} to ${current ? 'now' : clock(item.endAt)}, ${formatStay(dur)}`}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={[styles.placeIcon, { backgroundColor: place?.color ?? (item.placeId ? C.accent : C.fill) }]}>
          {place ? <PlaceSymbol icon={place.icon} size={20} color="white" /> : <SymbolView name={item.placeId ? 'mappin' : 'mappin.and.ellipse'} size={20} tintColor={item.placeId ? 'white' : C.label} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.headline, { color: C.label, fontSize: 18 }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[T.subhead, { color: C.secondaryLabel }]}>
            {clock(item.startAt)} – {current ? 'now' : clock(item.endAt)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[styles.stayChip, current && { flex: 1 }]}>
          {current ? <LiveDot /> : <SymbolView name="clock" size={15} tintColor={C.label} />}
          <Text style={styles.stayChipText}>{current ? `Happening now · ${formatStay(dur)}` : formatStay(dur)}</Text>
          {current && refresher.canRefresh && (
            <Tap
              onPress={() => void refresher.refresh()}
              hitSlop={10}
              style={{ marginLeft: 'auto' }}
              accessibilityRole="button"
              accessibilityLabel={`Refresh ${m.displayName}'s location`}
              accessibilityState={{ busy: refresher.refreshing }}
            >
              {refresher.refreshing ? <ActivityIndicator size="small" /> : <Text style={[styles.stayChipText, { color: C.accentText }]}>Refresh</Text>}
            </Tap>
          )}
        </View>
        {!current && <View style={{ flex: 1 }} />}
        {!item.placeId && (
          <Tap
            onPress={() => router.push({ pathname: '/place/[id]', params: { id: 'new', lat: String(item.lat), lon: String(item.lon) } })}
            style={styles.stayChip}
            accessibilityRole="button"
            accessibilityLabel="Save as a place"
          >
            <Text style={styles.stayChipText}>Save place</Text>
            <View style={[styles.chipIcon, { backgroundColor: C.accent }]}>
              <SymbolView name="mappin.and.ellipse" size={12} tintColor="white" />
            </View>
          </Tap>
        )}
      </View>
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
  bubbleBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: `${BUBBLE_COLOR}1F` },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 23, backgroundColor: C.fill },
  stayCard: { backgroundColor: C.cell, borderRadius: 26, borderCurve: 'continuous', padding: 16, gap: 14 },
  stayChip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: C.fill },
  stayChipText: { fontSize: 15, fontWeight: '600', color: C.label },
  chipIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  dayChip: { paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: C.cell, alignItems: 'center', justifyContent: 'center' },
  dayChipText: { fontSize: 15, fontWeight: '600', color: C.label },
});
