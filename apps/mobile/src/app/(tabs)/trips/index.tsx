import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMe } from '@/lib/session';
import { useLive, useTrips } from '@/lib/queries';
import { clock, dayLabel, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { C } from '@/lib/theme';
import type { Trip } from '@/lib/types';
import { Empty, Row, Section } from '@/components/ui';

export default function Trips() {
  const me = useMe();
  const units = me.preferences.units;
  const [personId, setPersonId] = useState(me.id);
  const { data: members = [] } = useLive();
  const person = members.find((m) => m.id === personId);
  const { data: trips = [], isLoading, refetch, isRefetching } = useTrips(personId, 60);

  const groups = useMemo(() => {
    const g = new Map<string, Trip[]>();
    for (const t of trips) {
      const k = dayLabel(t.startedAt);
      g.set(k, [...(g.get(k) ?? []), t]);
    }
    return [...g.entries()];
  }, [trips]);
  const week = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    return trips.filter((t) => new Date(t.startedAt) > since);
  }, [trips]);

  return (
    <>
      <Stack.Screen options={{ title: personId === me.id ? 'Trips' : `${person?.displayName.split(' ')[0] ?? ''}'s trips` }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="person.crop.circle" title="Show trips for">
          {members.map((m) => (
            <Stack.Toolbar.MenuAction key={m.id} isOn={m.id === personId} onPress={() => setPersonId(m.id)}>
              {m.id === me.id ? 'You' : m.displayName}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: C.groupedBackground }}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {trips.length > 0 && (
          <Section title="Last 7 days">
            <Row icon="car.fill" title="Trips" value={String(week.length)} />
            <Row icon="road.lanes" title="Distance" value={formatDistance(week.reduce((s, t) => s + t.distanceM, 0), units)} />
            <Row icon="clock.fill" title="Time travelling" value={formatDuration(week.reduce((s, t) => s + t.durationSec, 0))} last />
          </Section>
        )}
        {!isLoading && trips.length === 0 && (
          <Empty icon="car.side" title="No trips yet" body="Trips appear automatically after travelling a few hundred metres and stopping for a few minutes." />
        )}
        {groups.map(([day, list]) => (
          <Section key={day} title={day}>
            {list.map((t, i) => (
              <Row
                key={t.id}
                icon={t.mode === 'walking' ? 'figure.walk' : t.mode === 'cycling' ? 'bicycle' : 'car.fill'}
                iconColor={t.status === 'in_progress' ? C.accent : '#8E8E93'}
                title={`${t.startLabel ?? 'Somewhere'} → ${t.status === 'in_progress' ? 'now' : (t.endLabel ?? 'Somewhere')}`}
                subtitle={`${clock(t.startedAt)} · ${formatDistance(t.distanceM, units)} · ${formatDuration(t.durationSec)}${t.maxSpeed != null ? ` · max ${formatSpeed(t.maxSpeed, units)}` : ''}`}
                onPress={() => router.push(`/trips/${t.id}`)}
                last={i === list.length - 1}
              />
            ))}
          </Section>
        ))}
      </ScrollView>
    </>
  );
}
