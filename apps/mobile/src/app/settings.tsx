import { useState } from 'react';
import { ActionSheetIOS, Alert, Linking, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import * as Application from 'expo-application';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCircles } from '@/lib/queries';
import { useMe, useSession } from '@/lib/session';
import { ago } from '@/lib/format';
import { disablePush, enablePush, pushPermission } from '@/lib/push';
import { C, HEX, T } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { MODES, startTracking, stopTracking, trackingStatus, type TrackingMode } from '@/background/tracking';
import { lastUpload, pendingCount } from '@/background/upload';
import { Avatar, PrimaryButton, Row, Section, useToast } from '@/components/ui';

function HealthCard({ paused, running, always, lastSent, pending, onFix }: { paused: boolean; running: boolean; always: boolean; lastSent: string | null; pending: number; onFix: () => void }) {
  const state: { icon: SFSymbol; color: string; title: string; body: string; action?: string } = paused
    ? { icon: 'pause.circle.fill', color: HEX.orange, title: 'Sharing is paused', body: 'Nobody in your circles can see where you are.', action: 'Resume sharing' }
    : !running
      ? { icon: 'location.slash.fill', color: HEX.red, title: 'Not sharing from this iPhone', body: 'Your circles will only see your last known location.', action: 'Start sharing' }
      : !always
        ? { icon: 'exclamationmark.triangle.fill', color: HEX.orange, title: 'Only while Nodara is open', body: 'iOS stops sharing in the background unless location is set to "Always".', action: 'Open iOS Settings' }
        : { icon: 'checkmark.seal.fill', color: HEX.green, title: 'Sharing in the background', body: `Everything is working. Last update sent ${ago(lastSent)}${pending ? `, ${pending} waiting to upload` : ''}.` };
  return (
    <Animated.View entering={FadeInDown.springify()} style={{ marginHorizontal: 16, marginBottom: 28, padding: 18, borderRadius: 26, borderCurve: 'continuous', backgroundColor: C.cell, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: `${state.color}22`, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name={state.icon} size={28} tintColor={state.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[T.headline, { color: C.label }]}>{state.title}</Text>
          <Text style={[T.subhead, { color: C.secondaryLabel, marginTop: 2 }]}>{state.body}</Text>
        </View>
      </View>
      {state.action && <PrimaryButton title={state.action} onPress={onFix} />}
    </Animated.View>
  );
}

export default function Settings() {
  const me = useMe();
  const { server, config, signOut, disconnect, setMe } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const status = useQuery({ queryKey: ['tracking'], queryFn: trackingStatus, refetchInterval: 15_000 });
  const upload = useQuery({ queryKey: ['tracking', 'upload'], queryFn: async () => ({ last: await lastUpload(), pending: await pendingCount() }), refetchInterval: 15_000 });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<{ id: string; kind: string; pushEnabled: boolean }[]>('/api/devices') });
  const push = useQuery({ queryKey: ['push-permission'], queryFn: pushPermission });
  const t = status.data;
  const pushOn = push.data === 'granted' && Boolean(devices.data?.some((d) => d.kind === 'ios' && d.pushEnabled));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tracking'] });
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['push-permission'] });
  };

  const toggleTracking = async (on: boolean) => {
    if (on) return router.push('/share-location');
    setBusy(true);
    await stopTracking();
    refresh();
    setBusy(false);
  };

  const chooseMode = () => {
    const modes = Object.keys(MODES) as TrackingMode[];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Tracking mode', options: [...modes.map((m) => `${MODES[m].label} — ${MODES[m].detail}`), 'Cancel'], cancelButtonIndex: modes.length },
      async (i) => {
        if (!modes[i]) return;
        await startTracking(modes[i]!);
        refresh();
      },
    );
  };

  const setPaused = async (paused: boolean) => {
    try {
      setMe(await api.post<Me>('/api/me/sharing', { paused }));
      qc.invalidateQueries({ queryKey: ['live'] });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update sharing', body: (e as Error).message });
    }
  };

  const togglePush = async (on: boolean) => {
    try {
      if (on) {
        await enablePush();
        toast({ tone: 'success', title: 'Notifications are on', body: 'You will get arrivals, departures and check-ins.' });
      } else await disablePush();
    } catch (e) {
      toast({ tone: 'error', title: 'Notifications', body: (e as Error).message });
    }
    refresh();
  };

  const { data: circles = [] } = useCircles();
  const setCircleSharing = async (id: string, sharing: boolean) => {
    try {
      await api.patch(`/api/circles/${id}/me`, { sharing });
      qc.invalidateQueries({ queryKey: ['circles'] });
      qc.invalidateQueries({ queryKey: ['live'] });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update sharing', body: (e as Error).message });
    }
  };

  const setUnits = async (units: 'metric' | 'imperial') => setMe(await api.patch<Me>('/api/me', { preferences: { units } }));

  const permissionText =
    t?.background === 'granted' ? 'Always' : t?.foreground === 'granted' ? 'While using the app' : t?.foreground === 'denied' ? 'Off' : 'Not asked yet';

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}>
      <Section>
        <Row left={<Avatar name={me.displayName} color={me.avatarColor} size={48} />} title={me.displayName} subtitle={me.email} last />
      </Section>

      <HealthCard
        paused={me.sharingPaused}
        running={Boolean(t?.running)}
        always={t?.background === 'granted'}
        lastSent={upload.data?.last ?? null}
        pending={upload.data?.pending ?? 0}
        onFix={() => (me.sharingPaused ? void setPaused(false) : t?.running ? void Linking.openSettings() : router.push('/share-location'))}
      />

      <Section
        title="Location sharing"
        footer={
          t?.running && t.background !== 'granted'
            ? 'Nodara can only share while it is open. Allow "Always" in iOS Settings to share in the background.'
            : `Last sent ${ago(upload.data?.last)}${upload.data?.pending ? ` · ${upload.data.pending} waiting to upload` : ''}.`
        }
      >
        <Row
          icon="location.fill"
          iconColor={t?.running ? (C.green as string) : '#8E8E93'}
          title="Share from this iPhone"
          accessory={<Switch value={Boolean(t?.running)} disabled={busy} onValueChange={(v) => void toggleTracking(v)} trackColor={{ true: C.accent }} />}
        />
        <Row icon="slider.horizontal.3" iconColor="#5856D6" title="Mode" value={t ? MODES[t.mode].label : undefined} onPress={t?.running ? chooseMode : undefined} />
        <Row icon="lock.shield.fill" iconColor="#007AFF" title="Location permission" value={permissionText} onPress={() => void Linking.openSettings()} />
        <Row
          icon="pause.circle.fill"
          iconColor="#FF9500"
          title="Pause for all circles"
          subtitle="Hides your live location from everyone immediately"
          accessory={<Switch value={me.sharingPaused} onValueChange={(v) => void setPaused(v)} trackColor={{ true: C.orange }} />}
          last
        />
      </Section>

      {circles.length > 0 && (
        <Section title="Share with circles" footer="Turning sharing back on for a circle starts a new visible window — the gap stays private.">
          {circles.map((c, i) => (
            <Row
              key={c.id}
              icon="person.2.fill"
              iconColor={c.color}
              title={c.name}
              subtitle={`${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'} · ${c.role}`}
              accessory={<Switch value={c.sharing} onValueChange={(v) => void setCircleSharing(c.id, v)} trackColor={{ true: C.accent }} />}
              last={i === circles.length - 1}
            />
          ))}
        </Section>
      )}

      <Section title="Notifications" footer="Arrivals, departures and alerts. Your server relays them through Expo and Apple's push service; only the alert text is sent.">
        <Row icon="bell.badge.fill" iconColor="#FF3B30" title="Push notifications" accessory={<Switch value={pushOn} onValueChange={(v) => void togglePush(v)} trackColor={{ true: C.accent }} />} last />
      </Section>

      <Section title="Preferences">
        <Row
          icon="ruler.fill"
          iconColor="#34C759"
          title="Units"
          value={me.preferences.units === 'imperial' ? 'Miles' : 'Kilometres'}
          onPress={() => void setUnits(me.preferences.units === 'imperial' ? 'metric' : 'imperial')}
          last
        />
      </Section>

      <Section title={config?.instanceName ?? 'Server'} footer={server ?? undefined}>
        <Row icon="safari.fill" iconColor="#007AFF" title="Open web app" subtitle="History playback, places editor, admin" onPress={() => void WebBrowser.openBrowserAsync(server ?? '')} />
        <Row icon="square.and.arrow.down.fill" iconColor="#30B0C7" title="Export my data" onPress={() => void WebBrowser.openBrowserAsync(`${server}/settings/data`)} last />
      </Section>

      <Section>
        <Row title="Sign out" destructive onPress={() => Alert.alert('Sign out?', 'This iPhone will stop sharing your location.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} />
        <Row title="Use a different server" destructive onPress={() => Alert.alert('Disconnect from server?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => void signOut().then(disconnect) }])} last />
      </Section>
      <Text style={{ textAlign: 'center', color: C.tertiaryLabel, fontSize: 12 }}>
        Nodara {Application.nativeApplicationVersion ?? ''} · server {config?.version ?? ''} · AGPL-3.0
      </Text>
    </ScrollView>
  );
}
