import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { appear } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { useCircles, useDrivingEvents, useDrivingReport } from '@/lib/queries';
import { firstName, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { DRIVING_KINDS, KIND_INFO, redSpeedLabel } from '@/lib/driving';
import { C, HEX, T } from '@/lib/theme';
import type { DrivingPerson, DrivingReport } from '@/lib/types';
import { Avatar, Empty, Skeleton, Tap } from '@/components/ui';
import { EventChips, EventList, KindIcon, Trend } from '@/features/driving/components';

const WEEKS = 8;

function weekLabel(offset: number) {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Last week';
  const start = new Date();
  const dow = (start.getDay() + 6) % 7; // Monday = 0
  start.setDate(start.getDate() - dow - offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

/** Weekly driving report for a circle (or everyone you share with). */
export default function Driving() {
  const params = useLocalSearchParams<{ circleId?: string; user?: string }>();
  const me = useMe();
  const units = me.preferences.units;
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(params.user ?? null);
  const { data: circles = [] } = useCircles();
  const circleId = params.circleId ?? null;
  const circle = circles.find((c) => c.id === circleId);
  const report = useDrivingReport(circleId, offset);
  const data = report.data;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: C.groupedBackground }}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={report.isRefetching} onRefresh={() => void report.refetch()} />}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
        {Array.from({ length: WEEKS }, (_, i) => (
          <Tap key={i} onPress={() => setOffset(i)} style={[styles.week, offset === i && { backgroundColor: C.label }]} accessibilityState={{ selected: offset === i }}>
            <Text style={[styles.weekText, offset === i && { color: C.background }]}>{weekLabel(i)}</Text>
          </Tap>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, marginTop: 10, marginBottom: 16 }}>
        <Text style={[T.title1, { color: C.label }]}>Weekly driving report</Text>
        <Text style={[T.subhead, { color: C.secondaryLabel, marginTop: 2 }]}>
          {circle?.name ?? 'Everyone'}
          {data ? ` · ${range(data)}` : ''}
        </Text>
      </View>

      {report.isLoading ? (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <Skeleton height={190} />
          <Skeleton height={90} />
          <Skeleton height={120} />
        </View>
      ) : report.error || !data ? (
        <Empty icon="wifi.exclamationmark" title="Couldn't load the report" body={(report.error as Error | null)?.message ?? 'Your server may need updating to get driving reports.'} />
      ) : (
        <Animated.View key={offset} entering={appear} style={{ gap: 14 }}>
          {/* Event totals */}
          <View style={styles.grid}>
            {DRIVING_KINDS.map((k) => (
              <View key={k} style={styles.tile} accessible accessibilityLabel={`${KIND_INFO[k].label}: ${data.totals.events[k]}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <KindIcon kind={k} size={34} />
                  <Trend now={data.totals.events[k]} before={data.totals.previous[k]} size={16} />
                </View>
                <Text style={[styles.big, { color: data.totals.events[k] ? C.label : C.tertiaryLabel }]}>{data.totals.events[k]}</Text>
                <Text style={[T.footnote, { color: C.secondaryLabel, fontWeight: '600' }]}>{KIND_INFO[k].label}</Text>
              </View>
            ))}
          </View>

          {/* Top speed, drives and distance */}
          <View style={styles.rowTiles}>
            <View style={[styles.tile, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
              {(() => {
                const who = data.people.find((p) => p.user.id === data.totals.topSpeed?.userId);
                return who ? <Avatar name={who.user.displayName} color={who.user.avatarColor} url={who.user.avatarUrl} size={40} /> : <SymbolView name="gauge.with.dots.needle.67percent" size={30} tintColor={C.secondaryLabel} />;
              })()}
              <View style={{ flex: 1 }}>
                <Text style={[T.footnote, { color: C.secondaryLabel }]}>Top speed</Text>
                <Text style={[T.title3, { color: (data.totals.topSpeed?.speed ?? 0) * 3.6 >= data.speedingKmh ? HEX.red : C.label, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
                  {data.totals.topSpeed ? formatSpeed(data.totals.topSpeed.speed, units) : '—'}
                </Text>
              </View>
            </View>
            <View style={styles.tile}>
              <Line label="Drives" value={String(data.totals.drives)} />
              <Line label={units === 'imperial' ? 'Total miles' : 'Total km'} value={formatDistance(data.totals.distanceM, units)} />
              <Line label="Behind the wheel" value={formatDuration(data.totals.durationSec).replace(/ \d+ s$/, '')} />
            </View>
          </View>

          {/* People */}
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {data.people.map((p) => (
              <PersonCard key={p.user.id} p={p} report={data} expanded={open === p.user.id} onToggle={() => setOpen(open === p.user.id ? null : p.user.id)} />
            ))}
          </View>

          <Text style={styles.note}>
            Speeding means over {redSpeedLabel(units)}: Nodara has no speed-limit data. Hard braking and rapid acceleration are estimated from GPS speed and are most reliable in Precise mode. Phone use means the
            iPhone was unlocked, or Nodara opened, while moving, so passengers count too. These are estimates, not an insurance score.
          </Text>
        </Animated.View>
      )}
    </ScrollView>
  );
}

const range = (d: DrivingReport) => {
  const end = new Date(Date.parse(d.end) - 1000);
  const f = (x: Date) => x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${f(new Date(d.start))} – ${f(end)}`;
};

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={[T.footnote, { color: C.secondaryLabel }]}>{label}</Text>
      <Text style={[T.headline, { color: C.label, fontVariant: ['tabular-nums'] }]}>{value}</Text>
    </View>
  );
}

function PersonCard({ p, report, expanded, onToggle }: { p: DrivingPerson; report: DrivingReport; expanded: boolean; onToggle: () => void }) {
  const me = useMe();
  const units = me.preferences.units;
  const name = p.user.id === me.id ? 'You' : p.user.displayName;
  const events = useDrivingEvents(p.user.id, report.start, report.end, expanded && !p.hidden);

  if (p.hidden) {
    return (
      <View style={[styles.person, { opacity: 0.8 }]}>
        <Avatar name={p.user.displayName} color={p.user.avatarColor} url={p.user.avatarUrl} size={52} dim />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.headline, { color: C.label }]}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <SymbolView name="lock.fill" size={12} tintColor={C.secondaryLabel} />
            <Text style={[T.footnote, { color: C.secondaryLabel }]}>Drives aren&apos;t shared with you</Text>
          </View>
        </View>
      </View>
    );
  }

  const total = DRIVING_KINDS.reduce((s, k) => s + p.events[k], 0);
  return (
    <View style={[styles.person, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <Tap onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${name}, ${p.drives} drives, ${total} events`}>
        <Avatar name={p.user.displayName} color={p.user.avatarColor} url={p.user.avatarUrl} size={52} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[T.headline, { color: C.label }]}>{name}</Text>
          <Text style={[T.footnote, { color: C.secondaryLabel }]}>
            {p.drives} {p.drives === 1 ? 'drive' : 'drives'} · {formatDistance(p.distanceM, units)}
            {p.topSpeed ? ` · top ${formatSpeed(p.topSpeed, units)}` : ''}
          </Text>
          <EventChips counts={p.events} />
        </View>
        {total > 0 && <SymbolView name={expanded ? 'chevron.up' : 'chevron.down'} size={13} weight="semibold" tintColor={C.tertiaryLabel} />}
      </Tap>
      {expanded && total > 0 && (
        <Animated.View entering={appear} style={{ marginTop: 12 }}>
          {events.isLoading ? (
            <Skeleton height={60} />
          ) : (
            <EventList
              events={events.data ?? []}
              onOpenTrip={(id) => router.push(`/trip/${id}`)}
            />
          )}
          {p.user.id !== me.id && (
            <Text style={[T.footnote, { color: C.tertiaryLabel, marginTop: 10 }]}>
              Tap an event to see {firstName(p.user.displayName)}&apos;s drive.
            </Text>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  week: { paddingHorizontal: 16, height: 38, borderRadius: 19, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  weekText: { fontSize: 15, fontWeight: '700', color: C.label },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: C.cell, borderRadius: 22, borderCurve: 'continuous', padding: 14, gap: 6 },
  big: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 4 },
  rowTiles: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 24, borderCurve: 'continuous', backgroundColor: C.cell },
  note: { fontSize: 13, lineHeight: 18, color: C.secondaryLabel, marginHorizontal: 20, marginTop: 6 },
});
