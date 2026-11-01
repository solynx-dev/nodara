import { ActionSheetIOS, Alert, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { appear } from '@/lib/motion';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { ago } from '@/lib/format';
import { C, T } from '@/lib/theme';
import type { CircleDetail, CircleMember, Invitation } from '@/lib/types';
import { Avatar, AvatarStack, Empty, PrimaryButton, Row, Section, Skeleton, useToast } from '@/components/ui';

const RANK = { member: 0, admin: 1, owner: 2 } as const;
const roleLabel = (r: CircleMember['role']) => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : 'Member');

/** One circle: who's in it, inviting people, roles, and what members can see. */
export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: c, isLoading, error } = useQuery({ queryKey: ['circle', id], queryFn: () => api.get<CircleDetail>(`/api/circles/${id}`) });
  const isAdmin = c?.role === 'owner' || c?.role === 'admin';
  const invites = useQuery({ queryKey: ['circle', id, 'invitations'], enabled: isAdmin, queryFn: () => api.get<Invitation[]>(`/api/circles/${id}/invitations`) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['circle', id] });
    qc.invalidateQueries({ queryKey: ['circles'] });
    qc.invalidateQueries({ queryKey: ['live'] });
  };
  const run = async (fn: () => Promise<unknown>, errorTitle: string, success?: string) => {
    try {
      await fn();
      refresh();
      if (success) toast({ tone: 'success', title: success });
    } catch (e) {
      toast({ tone: 'error', title: errorTitle, body: (e as Error).message });
    }
  };

  if (isLoading) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Skeleton height={160} />
        <Skeleton height={220} />
      </ScrollView>
    );
  }
  if (!c) return <Empty icon="person.2.slash" title="Circle not found" body={(error as Error | null)?.message ?? 'You may have left this circle.'} />;

  const canInvite = isAdmin || c.settings.membersCanInvite;

  const invite = (role: 'member' | 'admin' = 'member') =>
    run(async () => {
      const r = await api.post<{ url: string }>(`/api/circles/${c.id}/invitations`, { expiresInHours: 72, maxUses: 1, role });
      qc.invalidateQueries({ queryKey: ['circle', id, 'invitations'] });
      await Share.share({ message: `Join "${c.name}" on Nodara so we can see where each other are: ${r.url}`, url: r.url });
    }, 'Could not create invitation');

  const manage = (m: CircleMember) => {
    if (m.id === me.id || !isAdmin || RANK[m.role] >= RANK[c.role]) return;
    const actions: { label: string; destructive?: boolean; go: () => void }[] = [];
    if (m.role === 'member') actions.push({ label: 'Make admin', go: () => void run(() => api.patch(`/api/circles/${c.id}/members/${m.id}`, { role: 'admin' }), 'Could not change role', `${m.displayName} is now an admin`) });
    if (m.role === 'admin') actions.push({ label: 'Make regular member', go: () => void run(() => api.patch(`/api/circles/${c.id}/members/${m.id}`, { role: 'member' }), 'Could not change role') });
    if (c.role === 'owner')
      actions.push({
        label: 'Make owner',
        go: () =>
          Alert.alert(`Make ${m.displayName} the owner?`, 'You will become an admin. Only the owner can delete the circle.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Make owner', onPress: () => void run(() => api.patch(`/api/circles/${c.id}/members/${m.id}`, { role: 'owner' }), 'Could not transfer ownership') },
          ]),
      });
    actions.push({
      label: `Remove from ${c.name}`,
      destructive: true,
      go: () =>
        Alert.alert(`Remove ${m.displayName}?`, 'They will stop seeing everyone in this circle, and you will stop seeing them.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => void run(() => api.del(`/api/circles/${c.id}/members/${m.id}`), 'Could not remove') },
        ]),
    });
    const options = [...actions.map((a) => a.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: m.displayName, options, cancelButtonIndex: actions.length, destructiveButtonIndex: actions.findIndex((a) => a.destructive) },
      (i) => actions[i]?.go(),
    );
  };

  const rename = () =>
    Alert.prompt('Rename circle', undefined, (name) => name?.trim() && void run(() => api.patch(`/api/circles/${c.id}`, { name: name.trim() }), 'Could not rename'), 'plain-text', c.name);

  const setSetting = (key: keyof CircleDetail['settings'], value: boolean) => void run(() => api.patch(`/api/circles/${c.id}`, { settings: { [key]: value } }), 'Could not update setting');

  const leave = () => {
    const alone = c.members.length === 1;
    if (c.role === 'owner' && !alone) {
      return Alert.alert('Choose a new owner first', 'Make someone else the owner (tap them in the list), then you can leave. Or delete the circle for everyone.');
    }
    Alert.alert(alone ? `Leave and delete ${c.name}?` : `Leave ${c.name}?`, alone ? "You're the only member, so the circle will be deleted." : 'You will stop seeing everyone here, and they will stop seeing you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await api.del(`/api/circles/${c.id}/members/${me.id}`);
            router.back();
          }, 'Could not leave'),
      },
    ]);
  };

  const remove = () =>
    Alert.alert(`Delete ${c.name}?`, `This removes the circle for all ${c.members.length} members. Their accounts and history are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete circle',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await api.del(`/api/circles/${c.id}`);
            router.back();
          }, 'Could not delete'),
      },
    ]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 }}>
      <Stack.Screen options={{ title: c.name }} />

      <Animated.View entering={appear} style={styles.hero}>
        <View style={[styles.badge, { backgroundColor: c.color }]}>
          <Text style={styles.badgeText}>{c.name.trim()[0]?.toUpperCase()}</Text>
        </View>
        <Text style={[T.title1, { color: C.label, textAlign: 'center' }]}>{c.name}</Text>
        <Text style={[T.subhead, { color: C.secondaryLabel }]}>
          {c.members.length} {c.members.length === 1 ? 'member' : 'members'} · you&apos;re {c.role === 'owner' ? 'the owner' : c.role === 'admin' ? 'an admin' : 'a member'}
        </Text>
        <AvatarStack people={c.members} size={40} max={6} />
        {canInvite && (
          <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
            <PrimaryButton title="Invite someone" icon="person.badge.plus" onPress={() => void invite()} />
          </View>
        )}
      </Animated.View>

      <Animated.View entering={appear}>
        <Section title="Members" footer={isAdmin ? 'Tap someone to change their role or remove them.' : undefined}>
          {c.members.map((m, i) => {
            const manageable = isAdmin && m.id !== me.id && RANK[m.role] < RANK[c.role];
            return (
              <Row
                key={m.id}
                left={
                  <View style={{ marginRight: 12 }}>
                    <Avatar name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={40} dim={!m.sharing} />
                  </View>
                }
                title={m.id === me.id ? `${m.displayName} (you)` : m.displayName}
                subtitle={`${roleLabel(m.role)} · ${m.sharing ? 'sharing location' : 'not sharing'}${m.email ? ` · ${m.email}` : ''}`}
                onPress={manageable ? () => manage(m) : undefined}
                last={i === c.members.length - 1}
              />
            );
          })}
        </Section>
      </Animated.View>

      <Section title="You in this circle" footer="Turning sharing back on starts a new visible window. The gap stays private.">
        <Row
          icon="location.fill"
          iconColor="#34C759"
          title="Share my location here"
          accessory={<Switch value={c.sharing} onValueChange={(v) => void run(() => api.patch(`/api/circles/${c.id}/me`, { sharing: v }), 'Could not update sharing')} trackColor={{ true: C.accent }} />}
        />
        <Row
          icon="bell.slash.fill"
          iconColor="#8E8E93"
          title="Mute this circle's alerts"
          accessory={<Switch value={Boolean(c.notify.muted)} onValueChange={(v) => void run(() => api.patch(`/api/circles/${c.id}/me`, { notify: { muted: v } }), 'Could not update')} trackColor={{ true: C.accent }} />}
          last
        />
      </Section>

      {isAdmin && (
        <Section title="What members can see" footer="Live locations are always shared. These control history and drives.">
          <Row icon="pencil" iconColor="#FF9500" title="Name" value={c.name} onPress={rename} />
          <Row icon="clock.arrow.circlepath" iconColor="#007AFF" title="Location history" subtitle="Where people have been" accessory={<Switch value={c.settings.historyVisible} onValueChange={(v) => setSetting('historyVisible', v)} trackColor={{ true: C.accent }} />} />
          <Row icon="car.fill" iconColor="#5856D6" title="Drives" subtitle="Trips with routes and speeds" accessory={<Switch value={c.settings.tripsVisible} onValueChange={(v) => setSetting('tripsVisible', v)} trackColor={{ true: C.accent }} />} />
          <Row icon="person.badge.plus" iconColor="#34C759" title="Members can invite" accessory={<Switch value={c.settings.membersCanInvite} onValueChange={(v) => setSetting('membersCanInvite', v)} trackColor={{ true: C.accent }} />} last />
        </Section>
      )}

      {isAdmin && !!invites.data?.length && (
        <Section title="Open invitations" footer="Tap an invitation to cancel it.">
          {invites.data.map((inv, i) => (
            <Row
              key={inv.id}
              icon="envelope.open.fill"
              iconColor="#30B0C7"
              title={`${inv.role === 'admin' ? 'Admin' : 'Member'} invite${inv.note ? ` · ${inv.note}` : ''}`}
              subtitle={`Created ${ago(inv.createdAt)}${inv.createdBy ? ` by ${inv.createdBy}` : ''} · expires ${new Date(inv.expiresAt).toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}
              onPress={() =>
                Alert.alert('Cancel this invitation?', 'The link will stop working.', [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Cancel invitation',
                    style: 'destructive',
                    onPress: () =>
                      void run(async () => {
                        await api.del(`/api/circles/${c.id}/invitations/${inv.id}`);
                        qc.invalidateQueries({ queryKey: ['circle', id, 'invitations'] });
                      }, 'Could not cancel'),
                  },
                ])
              }
              last={i === invites.data.length - 1}
            />
          ))}
        </Section>
      )}

      <Section>
        <Row title={`Leave ${c.name}`} destructive onPress={leave} last={c.role !== 'owner'} />
        {c.role === 'owner' && <Row title="Delete circle for everyone" destructive onPress={remove} last />}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 28, padding: 20, borderRadius: 28, borderCurve: 'continuous', backgroundColor: C.cell },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  badgeText: { color: 'white', fontSize: 32, fontWeight: '800' },
});
