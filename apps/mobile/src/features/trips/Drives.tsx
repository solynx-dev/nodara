import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { clock, dayLabel, formatDistance, formatDuration, formatSpeed, weekdayShort } from '@/lib/format';
import { C, HEX, T } from '@/lib/theme';
import type { Trip } from '@/lib/types';
import { Tap } from '@/components/ui';

export function tripTitle(t: Trip) {
  return `${t.startLabel ?? 'Somewhere'} → ${t.status === 'in_progress' ? 'now' : (t.endLabel ?? 'Somewhere')}`;
}

export const modeIcon = (t: Trip): SFSymbol => (t.mode === 'walking' ? 'figure.walk' : t.mode === 'cycling' ? 'bicycle' : 'car.fill');
export const modeLabel = (t: Trip) => (t.mode === 'walking' ? 'Walk' : t.mode === 'cycling' ? 'Ride' : t.mode === 'driving' ? 'Drive' : 'Trip');

/**
 * One drive, laid out like a route: where it started and when, what happened
 * on the way, where it ended and when.
 */
export function DriveCard({ t, onOpen, index = 0 }: { t: Trip; onOpen: (id: string) => void; index?: number }) {
  const units = useMe().preferences.units;
  const live = t.status === 'in_progress';
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 35).springify().damping(18)} layout={LinearTransition.springify()}>
      <Tap onPress={() => onOpen(t.id)} style={styles.card} accessibilityRole="button" accessibilityLabel={`${modeLabel(t)} from ${t.startLabel ?? 'somewhere'} to ${live ? 'now' : (t.endLabel ?? 'somewhere')}, ${formatDistance(t.distanceM, units)}, ${formatDuration(t.durationSec)}`}>
        <View style={styles.rail}>
          <View style={[styles.dot, { backgroundColor: HEX.green }]} />
          <View style={styles.line} />
          <View style={[styles.dot, { backgroundColor: live ? C.accent : HEX.red }]} />
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          <View style={styles.endRow}>
            <Text style={[T.headline, { color: C.label, flex: 1 }]} numberOfLines={1}>
              {t.startLabel ?? 'Somewhere'}
            </Text>
            <Text style={styles.time}>{clock(t.startedAt)}</Text>
          </View>
          <View style={styles.stats}>
            <View style={[styles.mode, live && { backgroundColor: C.accent }]}>
              <SymbolView name={modeIcon(t)} size={12} tintColor={live ? 'white' : C.label} />
            </View>
            <Text style={styles.stat}>{formatDistance(t.distanceM, units)}</Text>
            <Text style={styles.sep}>·</Text>
            <Text style={styles.stat}>{formatDuration(t.durationSec)}</Text>
            {t.maxSpeed != null && t.maxSpeed > 0 && (
              <>
                <Text style={styles.sep}>·</Text>
                <Text style={styles.stat}>top {formatSpeed(t.maxSpeed, units)}</Text>
              </>
            )}
          </View>
          <View style={styles.endRow}>
            <Text style={[T.headline, { color: live ? C.accent : C.label, flex: 1 }]} numberOfLines={1}>
              {live ? 'On the way now' : (t.endLabel ?? 'Somewhere')}
            </Text>
            {t.endedAt && <Text style={styles.time}>{clock(t.endedAt)}</Text>}
          </View>
        </View>
        <SymbolView name="chevron.right" size={12} weight="semibold" tintColor={C.tertiaryLabel} />
      </Tap>
    </Animated.View>
  );
}

/** Drives grouped by day, with a one-line total per day. */
export function DriveList({ trips, onOpen }: { trips: Trip[]; onOpen: (id: string) => void }) {
  const units = useMe().preferences.units;
  const groups = useMemo(() => {
    const g = new Map<string, Trip[]>();
    for (const t of trips) g.set(dayLabel(t.startedAt), [...(g.get(dayLabel(t.startedAt)) ?? []), t]);
    return [...g.entries()];
  }, [trips]);
  let n = 0;
  return (
    <View style={{ gap: 18 }}>
      {groups.map(([day, list]) => (
        <View key={day} style={{ gap: 8 }}>
          <View style={styles.dayRow}>
            <Text style={styles.dayTitle}>{day}</Text>
            <Text style={styles.dayTotal}>
              {list.length} {list.length === 1 ? 'trip' : 'trips'} · {formatDistance(list.reduce((s, t) => s + t.distanceM, 0), units)}
            </Text>
          </View>
          {list.map((t) => (
            <DriveCard key={t.id} t={t} onOpen={onOpen} index={n++} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** "Last 7 days": totals plus a small distance-per-day chart. */
export function WeekSummary({ trips }: { trips: Trip[] }) {
  const units = useMe().preferences.units;
  const { days, count, distance, time, top } = useMemo(() => {
    const out: { label: string; distance: number; today: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = d.getTime() + 86_400_000;
      const dist = trips.filter((t) => Date.parse(t.startedAt) >= d.getTime() && Date.parse(t.startedAt) < next).reduce((s, t) => s + t.distanceM, 0);
      out.push({ label: i === 0 ? 'Today' : weekdayShort(d), distance: dist, today: i === 0 });
    }
    return {
      days: out,
      count: trips.length,
      distance: trips.reduce((s, t) => s + t.distanceM, 0),
      time: trips.reduce((s, t) => s + t.durationSec, 0),
      top: trips.reduce((m, t) => Math.max(m, t.maxSpeed ?? 0), 0),
    };
  }, [trips]);
  const max = Math.max(1, ...days.map((d) => d.distance));
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.week}>
      <Text style={styles.weekTitle}>Last 7 days</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Big value={String(count)} label={count === 1 ? 'trip' : 'trips'} />
        <Big value={formatDistance(distance, units)} label="travelled" />
        <Big value={formatDuration(time).replace(/ \d+ s$/, '')} label="on the move" />
      </View>
      <View style={styles.chart} accessible accessibilityLabel={`Distance per day: ${days.map((d) => `${d.label} ${formatDistance(d.distance, units)}`).join(', ')}`}>
        {days.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: `${Math.max(d.distance ? 8 : 0, (d.distance / max) * 100)}%`, backgroundColor: d.today ? C.accent : HEX.blue }]} />
            </View>
            <Text style={[styles.barLabel, d.today && { color: C.label }]} numberOfLines={1}>
              {d.label}
            </Text>
          </View>
        ))}
      </View>
      {top > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SymbolView name="gauge.with.dots.needle.67percent" size={14} tintColor={C.secondaryLabel} />
          <Text style={[T.footnote, { color: C.secondaryLabel }]}>Top speed this week: {formatSpeed(top, units)}</Text>
        </View>
      )}
    </Animated.View>
  );
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[T.title2, { color: C.label }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[T.footnote, { color: C.secondaryLabel }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingRight: 12, borderRadius: 24, borderCurve: 'continuous', backgroundColor: C.cell },
  rail: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 6, width: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { flex: 1, width: 2, borderRadius: 1, backgroundColor: C.separator, marginVertical: 3 },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { fontSize: 14, fontWeight: '500', color: C.secondaryLabel, fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  mode: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  stat: { fontSize: 13, fontWeight: '600', color: C.secondaryLabel },
  sep: { fontSize: 13, color: C.tertiaryLabel },
  dayRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: 4 },
  dayTitle: { fontSize: 15, fontWeight: '700', color: C.label },
  dayTotal: { fontSize: 13, color: C.secondaryLabel },
  week: { backgroundColor: C.cell, borderRadius: 24, borderCurve: 'continuous', padding: 16, gap: 14 },
  weekTitle: { fontSize: 13, fontWeight: '700', color: C.secondaryLabel, textTransform: 'uppercase' },
  chart: { flexDirection: 'row', gap: 6, height: 92 },
  barTrack: { flex: 1, width: '70%', maxWidth: 26, justifyContent: 'flex-end', borderRadius: 6, backgroundColor: C.fill, overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 6 },
  barLabel: { fontSize: 11, fontWeight: '600', color: C.tertiaryLabel },
});
