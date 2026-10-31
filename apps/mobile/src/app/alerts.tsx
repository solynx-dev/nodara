import { useMemo } from 'react';
import { RefreshControl, SectionList, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { api } from '@/lib/api';
import { ago, clock, dayLabel } from '@/lib/format';
import { routeForUrl } from '@/lib/push';
import { C, HEX, T } from '@/lib/theme';
import type { AppNotification } from '@/lib/types';
import { Empty, Skeleton, Tap } from '@/components/ui';

const ICONS: Record<string, { icon: SFSymbol; color: string; label: string }> = {
  arrival: { icon: 'arrow.down.right.circle.fill', color: HEX.green, label: 'Arrival' },
  departure: { icon: 'arrow.up.right.circle.fill', color: HEX.orange, label: 'Departure' },
  check_in: { icon: 'mappin.circle.fill', color: '#FF6B3D', label: 'Check-in' },
  member_joined: { icon: 'person.crop.circle.badge.plus', color: HEX.blue, label: 'Circle' },
  sharing_changed: { icon: 'eye.circle.fill', color: HEX.gray, label: 'Sharing' },
  low_battery: { icon: 'battery.25percent', color: HEX.red, label: 'Battery' },
  device_offline: { icon: 'antenna.radiowaves.left.and.right.slash', color: HEX.orange, label: 'Offline' },
  retention: { icon: 'trash.circle.fill', color: HEX.gray, label: 'History' },
};

export default function Alerts() {
  const qc = useQueryClient();
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/api/notifications?limit=80'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({ mutationFn: () => api.post('/api/notifications/read', { all: true }), onSuccess: refresh });
  const markOne = useMutation({ mutationFn: (id: string) => api.post('/api/notifications/read', { ids: [id] }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/notifications/${id}`), onSuccess: refresh });

  const sections = useMemo(() => {
    const g = new Map<string, AppNotification[]>();
    for (const n of data?.items ?? []) g.set(dayLabel(n.createdAt), [...(g.get(dayLabel(n.createdAt)) ?? []), n]);
    return [...g.entries()].map(([title, items]) => ({ title, data: items }));
  }, [data]);

  return (
    <>
      <Stack.Screen options={{ title: data?.unread ? `Alerts (${data.unread})` : 'Alerts' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark.circle" accessibilityLabel="Mark all as read" disabled={!data?.unread} onPress={() => markAll.mutate()} />
      </Stack.Toolbar>
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: C.groupedBackground }}
        contentContainerStyle={{ paddingBottom: 60, paddingHorizontal: 16 }}
        sections={sections}
        keyExtractor={(n) => n.id}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListHeaderComponent={
          isLoading ? (
            <View style={{ gap: 10, marginTop: 12 }}>
              <Skeleton height={76} />
              <Skeleton height={76} />
              <Skeleton height={76} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          isLoading ? undefined : <Empty icon="bell.badge" title="You're all caught up" body="Arrivals, departures, check-ins, low battery warnings and circle activity will show up here." />
        }
        renderSectionHeader={({ section }) => <Text style={{ fontSize: 13, fontWeight: '700', color: C.secondaryLabel, textTransform: 'uppercase', marginTop: 18, marginBottom: 8, marginLeft: 4 }}>{section.title}</Text>}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item: n, index }) => {
          const meta = ICONS[n.type] ?? { icon: 'bell.circle.fill' as SFSymbol, color: '#FF6B3D', label: 'Alert' };
          const route = routeForUrl(n.data.url as string | undefined);
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 30).springify()} layout={LinearTransition}>
              <Tap
                onPress={() => {
                  if (!n.readAt) markOne.mutate(n.id);
                  if (route && route !== '/alerts') router.navigate(route as never);
                }}
                onLongPress={() => remove.mutate(n.id)}
                accessibilityLabel={`${meta.label}: ${n.title}. ${ago(n.createdAt)}.${n.readAt ? '' : ' Unread.'}`}
                accessibilityHint="Long-press to delete"
                style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 22, borderCurve: 'continuous', backgroundColor: C.cell }}
              >
                <SymbolView name={meta.icon} size={32} tintColor={meta.color} type="hierarchical" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[T.caption, { color: meta.color, textTransform: 'uppercase' }]}>{meta.label}</Text>
                  <Text style={[T.callout, { fontWeight: n.readAt ? '500' : '700', color: C.label }]}>{n.title}</Text>
                  {!!n.body && <Text style={[T.subhead, { color: C.secondaryLabel }]}>{n.body}</Text>}
                  <Text style={[T.footnote, { color: C.tertiaryLabel }]}>
                    {clock(n.createdAt)} · {ago(n.createdAt)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  {!n.readAt ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF6B3D', marginTop: 4 }} /> : <View />}
                  {route && route !== '/alerts' && <SymbolView name="chevron.right" size={12} tintColor={C.tertiaryLabel} />}
                </View>
              </Tap>
            </Animated.View>
          );
        }}
      />
    </>
  );
}
