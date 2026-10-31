import { RefreshControl, ScrollView, Text, View, Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { routeForUrl } from '@/lib/push';
import { C } from '@/lib/theme';
import type { AppNotification } from '@/lib/types';
import { Empty } from '@/components/ui';

const ICONS: Record<string, { icon: SFSymbol; color: string }> = {
  arrival: { icon: 'arrow.down.right.circle.fill', color: '#34C759' },
  departure: { icon: 'arrow.up.right.circle.fill', color: '#FF9500' },
  member_joined: { icon: 'person.crop.circle.badge.plus', color: '#007AFF' },
  sharing_changed: { icon: 'eye.circle.fill', color: '#8E8E93' },
  low_battery: { icon: 'battery.25percent', color: '#FF3B30' },
  device_offline: { icon: 'antenna.radiowaves.left.and.right.slash', color: '#FF9500' },
  retention: { icon: 'trash.circle.fill', color: '#8E8E93' },
};

export default function Alerts() {
  const qc = useQueryClient();
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/api/notifications?limit=60'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({ mutationFn: () => api.post('/api/notifications/read', { all: true }), onSuccess: refresh });
  const markOne = useMutation({ mutationFn: (id: string) => api.post('/api/notifications/read', { ids: [id] }), onSuccess: refresh });
  const items = data?.items ?? [];

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark.circle" accessibilityLabel="Mark all as read" disabled={!data?.unread} onPress={() => markAll.mutate()} />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: C.groupedBackground }}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120, paddingHorizontal: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {!isLoading && items.length === 0 && <Empty icon="bell.badge" title="You're all caught up" body="Arrivals, departures, low battery warnings and circle activity show up here." />}
        {items.map((n) => {
          const meta = ICONS[n.type] ?? { icon: 'bell.circle.fill' as SFSymbol, color: C.accent };
          return (
            <Pressable
              key={n.id}
              onPress={() => {
                if (!n.readAt) markOne.mutate(n.id);
                const r = routeForUrl(n.data.url as string | undefined);
                if (r && r !== '/alerts') router.push(r as never);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 12,
                padding: 14,
                borderRadius: 22,
                borderCurve: 'continuous',
                backgroundColor: C.cell,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <SymbolView name={meta.icon} size={30} tintColor={meta.color} type="hierarchical" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: n.readAt ? '400' : '600', color: C.label }}>{n.title}</Text>
                {!!n.body && <Text style={{ fontSize: 14, color: C.secondaryLabel }}>{n.body}</Text>}
                <Text style={{ fontSize: 13, color: C.tertiaryLabel }}>{ago(n.createdAt)}</Text>
              </View>
              {!n.readAt && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent, marginTop: 6 }} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}
