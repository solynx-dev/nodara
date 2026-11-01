import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { useDrivingReport } from '@/lib/queries';
import { clock, dayLabel, firstName, formatDistance, formatSpeed } from '@/lib/format';
import { DRIVING_KINDS, KIND_INFO, type DrivingKind } from '@/lib/driving';
import { C, HEX, T } from '@/lib/theme';
import type { DrivingCounts, DrivingEvent } from '@/lib/types';
import { Skeleton, Tap } from '@/components/ui';

/** Compared with last week: fewer is good (green, down), more is bad (red, up). */
export function Trend({ now, before, size = 14 }: { now: number; before: number; size?: number }) {
  const icon: SFSymbol = now < before ? 'arrow.down.right' : now > before ? 'arrow.up.right' : 'arrow.right';
  const color = now < before ? HEX.green : now > before ? HEX.red : HEX.gray;
  const words = now < before ? `down from ${before} last week` : now > before ? `up from ${before} last week` : 'same as last week';
  return (
    <View accessible accessibilityLabel={words}>
      <SymbolView name={icon} size={size} weight="bold" tintColor={color} />
    </View>
  );
}

export function KindIcon({ kind, size = 34 }: { kind: DrivingKind; size?: number }) {
  const k = KIND_INFO[kind];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${k.color}26`, alignItems: 'center', justifyContent: 'center' }}>
      <SymbolView name={k.icon} size={size * 0.5} tintColor={k.color} />
    </View>
  );
}

/** One event type as a row: icon, name, count and trend. */
export function EventRow({ kind, count, previous }: { kind: DrivingKind; count: number; previous: number }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${KIND_INFO[kind].label}: ${count}`}>
      <KindIcon kind={kind} size={32} />
      <Text style={[T.body, { color: C.label, flex: 1 }]}>{KIND_INFO[kind].label}</Text>
      <View style={styles.countPill}>
        <Text style={[T.headline, { color: count ? C.label : C.secondaryLabel, fontVariant: ['tabular-nums'] }]}>{count}</Text>
        <Trend now={count} before={previous} />
      </View>
    </View>
  );
}

/** A person's week on their profile: the four event types, with a link to the full report. */
export function DrivingWeekCard({ userId, onOpenReport }: { userId: string; onOpenReport: () => void }) {
  const me = useMe();
  const { data, isLoading } = useDrivingReport(null, 0);
  if (isLoading) return <Skeleton height={260} />;
  const p = data?.people.find((x) => x.user.id === userId);
  if (!data || !p || p.hidden) return null;
  const since = new Date(data.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.bigIcon, { backgroundColor: C.accentSoft }]}>
          <SymbolView name="steeringwheel" size={24} tintColor={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[T.headline, { color: C.label }]}>{userId === me.id ? 'Your driving this week' : `${firstName(p.user.displayName)}'s driving this week`}</Text>
          <Text style={[T.footnote, { color: C.secondaryLabel }]}>
            Since {since} · {p.drives} {p.drives === 1 ? 'drive' : 'drives'} · {formatDistance(p.distanceM, me.preferences.units)}
          </Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {DRIVING_KINDS.map((k) => (
          <EventRow key={k} kind={k} count={p.events[k]} previous={p.previous[k]} />
        ))}
      </View>
      <Tap onPress={onOpenReport} style={styles.reportLink} accessibilityRole="button">
        <SymbolView name="chart.bar.doc.horizontal" size={17} tintColor={C.accent} />
        <Text style={[T.headline, { color: C.label, flex: 1 }]}>Weekly driving report</Text>
        <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />
      </Tap>
    </View>
  );
}

/** Entry point on the People tab: this week's drives and events for the circle. */
export function DrivingSummaryCard({ circleId }: { circleId: string | null }) {
  const me = useMe();
  const { data } = useDrivingReport(circleId, 0);
  const events = data ? DRIVING_KINDS.reduce((s, k) => s + data.totals.events[k], 0) : 0;
  const open = () => router.push(circleId ? { pathname: '/driving', params: { circleId } } : '/driving');
  return (
    <Tap onPress={open} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }]} accessibilityRole="button" accessibilityLabel="Weekly driving report">
      <View style={[styles.bigIcon, { backgroundColor: 'rgba(0,122,255,0.14)' }]}>
        <SymbolView name="car.fill" size={22} tintColor={HEX.blue} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.headline, { color: C.label }]}>Weekly driving report</Text>
        <Text style={[T.footnote, { color: C.secondaryLabel }]} numberOfLines={2}>
          {data
            ? `${data.totals.drives} ${data.totals.drives === 1 ? 'drive' : 'drives'} · ${formatDistance(data.totals.distanceM, me.preferences.units)} · ${events ? `${events} ${events === 1 ? 'event' : 'events'}` : 'no risky events'} this week`
            : 'Speeding, phone use, hard braking and more'}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />
    </Tap>
  );
}

/** Small chips summarising non-zero event counts: "2 speeding · 1 hard braking". */
export function EventChips({ counts }: { counts: DrivingCounts }) {
  const shown = DRIVING_KINDS.filter((k) => counts[k] > 0);
  if (!shown.length) {
    return (
      <View style={[styles.chip, { backgroundColor: 'rgba(52,199,89,0.14)' }]}>
        <SymbolView name="checkmark.seal.fill" size={12} tintColor={HEX.green} />
        <Text style={[styles.chipText, { color: HEX.green }]}>No risky events</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {shown.map((k) => (
        <View key={k} style={[styles.chip, { backgroundColor: `${KIND_INFO[k].color}1F` }]}>
          <SymbolView name={KIND_INFO[k].icon} size={11} tintColor={KIND_INFO[k].color} />
          <Text style={[styles.chipText, { color: KIND_INFO[k].color }]}>
            {counts[k]} {KIND_INFO[k].short}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Individual events, newest first, grouped by day. Tapping one opens its drive. */
export function EventList({ events, onOpenTrip }: { events: DrivingEvent[]; onOpenTrip?: (id: string) => void }) {
  const units = useMe().preferences.units;
  return (
    <View style={{ gap: 6 }}>
      {events.map((e, i) => {
        const day = dayLabel(e.startedAt);
        const header = i === 0 || dayLabel(events[i - 1]!.startedAt) !== day ? day : null;
        const k = KIND_INFO[e.kind];
        const detail =
          e.kind === 'speeding'
            ? `Up to ${formatSpeed(e.speed, units)}`
            : e.kind === 'phone_use'
              ? `At ${formatSpeed(e.speed, units)}`
              : `${formatSpeed(e.speed, units)}, ${Math.abs(e.value ?? 0).toFixed(1)} m/s²`;
        return (
          <View key={e.id} style={{ gap: 6 }}>
            {header && <Text style={styles.day}>{header}</Text>}
            <Tap disabled={!e.tripId || !onOpenTrip} onPress={() => e.tripId && onOpenTrip?.(e.tripId)} style={styles.eventRow} accessibilityRole={e.tripId ? 'button' : undefined}>
              <KindIcon kind={e.kind} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={[T.subhead, { color: C.label, fontWeight: '600' }]}>{k.label}</Text>
                <Text style={[T.footnote, { color: C.secondaryLabel }]}>
                  {clock(e.startedAt)} · {detail}
                </Text>
              </View>
              {e.tripId && onOpenTrip && <SymbolView name="chevron.right" size={12} tintColor={C.tertiaryLabel} />}
            </Tap>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.cell, borderRadius: 24, borderCurve: 'continuous', padding: 16, gap: 14 },
  bigIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 18, backgroundColor: C.elevated },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: C.fill },
  reportLink: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: C.accentSoft },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12 },
  chipText: { fontSize: 12, fontWeight: '700' },
  day: { fontSize: 13, fontWeight: '700', color: C.secondaryLabel, marginTop: 6, marginLeft: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: C.elevated },
});
