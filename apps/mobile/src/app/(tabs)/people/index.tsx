import { Alert, RefreshControl, ScrollView, Share, Switch } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useCircles, useLive } from '@/lib/queries';
import { ago, firstName, freshness } from '@/lib/format';
import { C } from '@/lib/theme';
import type { CircleDetail } from '@/lib/types';
import { Avatar, Empty, PrimaryButton, Row, Section } from '@/components/ui';

export default function People() {
  const me = useMe();
  const qc = useQueryClient();
  const { data: circles = [], isLoading, refetch, isRefetching } = useCircles();
  const { data: live = [] } = useLive();
  const details = useQueries({ queries: circles.map((c) => ({ queryKey: ['circle', c.id], queryFn: () => api.get<CircleDetail>(`/api/circles/${c.id}`) })) });
  const liveById = new Map(live.map((m) => [m.id, m]));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['circles'] });
    qc.invalidateQueries({ queryKey: ['circle'] });
    qc.invalidateQueries({ queryKey: ['live'] });
  };
  const share = useMutation({ mutationFn: ({ id, sharing }: { id: string; sharing: boolean }) => api.patch(`/api/circles/${id}/me`, { sharing }), onSuccess: refresh });

  const newCircle = () =>
    Alert.prompt('New circle', 'Family, roommates, a road trip…', async (name) => {
      if (!name?.trim()) return;
      try {
        await api.post('/api/circles', { name: name.trim() });
        refresh();
      } catch (e) {
        Alert.alert('Could not create circle', (e as Error).message);
      }
    });

  const invite = async (circleId: string, name: string) => {
    try {
      const r = await api.post<{ url: string }>(`/api/circles/${circleId}/invitations`, { expiresInHours: 72, maxUses: 1 });
      await Share.share({ message: `Join "${name}" on Nodara so we can see where each other are: ${r.url}`, url: r.url });
    } catch (e) {
      Alert.alert('Could not create invitation', (e as Error).message);
    }
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New circle" onPress={newCircle} />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: C.groupedBackground }}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {!isLoading && circles.length === 0 && (
          <Empty
            icon="person.3.fill"
            title="Create your first circle"
            body="Circles are the people you share with — your family, your partner, a travel group."
            action={<PrimaryButton title="New circle" icon="plus" onPress={newCircle} />}
          />
        )}
        {circles.map((c, i) => {
          const d = details[i]?.data;
          const canInvite = c.role !== 'member' || c.settings.membersCanInvite;
          return (
            <Section key={c.id} title={c.name} footer={c.sharing ? `${firstName(me.displayName)}, you're sharing your location with ${c.name}.` : `You're not sharing your location with ${c.name}.`}>
              {(d?.members ?? []).map((mem) => {
                const l = liveById.get(mem.id);
                const f = freshness(l?.location?.recordedAt);
                return (
                  <Row
                    key={mem.id}
                    left={<Avatar name={mem.displayName} color={mem.avatarColor} size={36} dim={!mem.sharing} />}
                    title={mem.id === me.id ? `${mem.displayName} (you)` : mem.displayName}
                    subtitle={
                      !mem.sharing ? 'Not sharing' : l?.currentPlace ? `At ${l.currentPlace.name}` : l?.location ? (f === 'live' ? 'Live now' : `Updated ${ago(l.location.recordedAt)}`) : 'No location yet'
                    }
                    value={mem.role !== 'member' ? mem.role : undefined}
                    onPress={l?.location ? () => router.push(`/member/${mem.id}`) : undefined}
                  />
                );
              })}
              <Row
                icon="location.fill"
                iconColor={c.sharing ? (C.green as string) : '#8E8E93'}
                title="Share my location"
                accessory={<Switch value={c.sharing} onValueChange={(v) => share.mutate({ id: c.id, sharing: v })} trackColor={{ true: C.accent }} />}
                last={!canInvite}
              />
              {canInvite && <Row icon="person.badge.plus" iconColor="#007AFF" title="Invite someone" subtitle="Send a one-time link (expires in 3 days)" onPress={() => void invite(c.id, c.name)} last />}
            </Section>
          );
        })}
      </ScrollView>
    </>
  );
}
