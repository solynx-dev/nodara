import { useState } from 'react';
import { ActionSheetIOS, Alert, Linking, ScrollView, Switch, Text } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Application from 'expo-application';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { ago } from '@/lib/format';
import { disablePush, enablePush, pushPermission } from '@/lib/push';
import { C } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { MODES, startTracking, stopTracking, trackingStatus, type TrackingMode } from '@/background/tracking';
import { lastUpload, pendingCount } from '@/background/upload';
import { Avatar, Row, Section } from '@/components/ui';

export default function Settings() {
  const me = useMe();
  const { server, config, signOut, disconnect, setMe } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
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
      Alert.alert('Could not update sharing', (e as Error).message);
    }
  };

  const togglePush = async (on: boolean) => {
    try {
      if (on) await enablePush();
      else await disablePush();
    } catch (e) {
      Alert.alert('Notifications', (e as Error).message);
    }
    refresh();
  };

  const setUnits = async (units: 'metric' | 'imperial') => setMe(await api.patch<Me>('/api/me', { preferences: { units } }));

  const permissionText =
    t?.background === 'granted' ? 'Always' : t?.foreground === 'granted' ? 'While using the app' : t?.foreground === 'denied' ? 'Off' : 'Not asked yet';

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}>
      <Section>
        <Row left={<Avatar name={me.displayName} color={me.avatarColor} size={48} />} title={me.displayName} subtitle={me.email} last />
      </Section>

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
