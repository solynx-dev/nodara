import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Animated from 'react-native-reanimated';
import { appear } from '@/lib/motion';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import * as Application from 'expo-application';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapType } from 'react-native-maps';
import { api } from '@/lib/api';
import { useCircles, usePlaces, useWeekTrips } from '@/lib/queries';
import { useMe, useSession } from '@/lib/session';
import { ago, formatDistance } from '@/lib/format';
import { disablePush, enablePush, pushPermission } from '@/lib/push';
import { getMapType, MAP_TYPES, setMapTypePref } from '@/lib/prefs';
import { getItem, KEYS } from '@/lib/storage';
import { C, HEX, T } from '@/lib/theme';
import type { Device, Me, NotifyKey, NotifyPrefs } from '@/lib/types';
import { MODES, startTracking, stopTracking, trackingStatus, type TrackingMode } from '@/background/tracking';
import { lastUpload, pendingCount } from '@/background/upload';
import { Avatar, PrimaryButton, Row, Section, Segmented, Tap, useToast } from '@/components/ui';

const SOURCE_URL = 'https://github.com/solynx-dev/nodara';

const NOTIFY_TYPES: { key: NotifyKey; icon: SFSymbol; color: string; title: string; subtitle: string }[] = [
  { key: 'places', icon: 'mappin.and.ellipse', color: '#34C759', title: 'Arrivals & departures', subtitle: 'Someone gets to or leaves a place' },
  { key: 'circle', icon: 'hand.wave.fill', color: '#5856D6', title: 'Check-ins & new members', subtitle: 'Check-ins and people joining' },
  { key: 'sharing', icon: 'eye.fill', color: '#007AFF', title: 'Sharing changes', subtitle: 'Someone pauses or resumes sharing' },
  { key: 'lowBattery', icon: 'battery.25percent', color: '#FF3B30', title: 'Low battery', subtitle: "Someone's phone is about to die" },
  { key: 'deviceOffline', icon: 'iphone.slash', color: '#8E8E93', title: 'Phones going quiet', subtitle: "Someone's phone stops reporting" },
];

const deviceIcon = (kind: string): SFSymbol => (kind === 'ios' ? 'iphone' : kind === 'android' ? 'smartphone' : kind === 'web' ? 'globe' : 'antenna.radiowaves.left.and.right');
const deviceKind = (kind: string) => (kind === 'ios' ? 'iPhone app' : kind === 'web' ? 'Browser' : kind === 'owntracks' ? 'OwnTracks' : kind === 'overland' ? 'Overland' : kind);

// ---------------------------------------------------------------------------

function ProfileCard({ me, circles, places, trips, distance }: { me: Me; circles: number; places: number; trips: number; distance: string }) {
  return (
    <Animated.View entering={appear} style={styles.profile}>
      <Tap onPress={() => router.push('/edit-profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }} accessibilityRole="button" accessibilityLabel="Edit profile">
        <View>
          <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={76} />
          <View style={styles.camera}>
            <SymbolView name="camera.fill" size={12} tintColor="white" />
          </View>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.title2, { color: C.label }]} numberOfLines={1}>
            {me.displayName}
          </Text>
          <Text style={[T.subhead, { color: C.secondaryLabel }]} numberOfLines={1}>
            {me.email}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {me.isAdmin && <Badge text="Server admin" color={C.indigo as string} />}
            <Badge text={`Joined ${new Date(me.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`} color={HEX.gray} />
          </View>
        </View>
        <SymbolView name="chevron.right" size={14} weight="semibold" tintColor={C.tertiaryLabel} />
      </Tap>
      <View style={styles.statsRow}>
        <Stat value={String(circles)} label={circles === 1 ? 'circle' : 'circles'} />
        <View style={styles.statSep} />
        <Stat value={String(places)} label={places === 1 ? 'place' : 'places'} />
        <View style={styles.statSep} />
        <Stat value={String(trips)} label="trips this week" />
        <View style={styles.statSep} />
        <Stat value={distance} label="this week" />
      </View>
    </Animated.View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: `${color}22` }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color }}>{text}</Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[T.headline, { color: C.label }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ fontSize: 11, color: C.secondaryLabel, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function HealthCard({ paused, running, always, lastSent, pending, onFix }: { paused: boolean; running: boolean; always: boolean; lastSent: string | null; pending: number; onFix: () => void }) {
  const state: { icon: SFSymbol; color: string; title: string; body: string; action?: string } = paused
    ? { icon: 'pause.circle.fill', color: HEX.orange, title: 'Sharing is paused', body: 'Nobody in your circles can see where you are.', action: 'Resume sharing' }
    : !running
      ? { icon: 'location.slash.fill', color: HEX.red, title: 'Not sharing from this iPhone', body: 'Your circles only see your last known location.', action: 'Start sharing' }
      : !always
        ? { icon: 'exclamationmark.triangle.fill', color: HEX.orange, title: 'Only while Nodara is open', body: 'iOS stops sharing in the background unless location access is "Always".', action: 'Open iOS Settings' }
        : { icon: 'checkmark.seal.fill', color: HEX.green, title: 'Sharing in the background', body: `All good. Last update sent ${ago(lastSent)}${pending ? `, ${pending} waiting to upload` : ''}.` };
  return (
    <Animated.View entering={appear} style={[styles.health, { borderColor: `${state.color}55` }]}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${state.color}22`, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name={state.icon} size={26} tintColor={state.color} />
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

// ---------------------------------------------------------------------------

export default function Settings() {
  const me = useMe();
  const { server, config, signOut, disconnect, setMe } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [mapType, setMapType] = useState<MapType>('standard');
  const status = useQuery({ queryKey: ['tracking'], queryFn: trackingStatus, refetchInterval: 15_000 });
  const upload = useQuery({ queryKey: ['tracking', 'upload'], queryFn: async () => ({ last: await lastUpload(), pending: await pendingCount() }), refetchInterval: 15_000 });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<Device[]>('/api/devices') });
  const thisDevice = useQuery({ queryKey: ['devices', 'this'], queryFn: () => getItem(KEYS.deviceId) });
  const push = useQuery({ queryKey: ['push-permission'], queryFn: pushPermission });
  const { data: circles = [] } = useCircles();
  const { data: places = [] } = usePlaces();
  const week = useWeekTrips(me.id);
  const t = status.data;
  const units = me.preferences.units;
  const pushOn = push.data === 'granted' && Boolean(devices.data?.some((d) => d.id === thisDevice.data && d.pushEnabled));
  const notify = ((me.preferences as unknown as { notifications?: NotifyPrefs }).notifications ?? {}) as NotifyPrefs;

  useFocusEffect(
    useCallback(() => {
      void getMapType().then((m) => m && setMapType(m));
    }, []),
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tracking'] });
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['push-permission'] });
  };
  const fail = (title: string) => (e: unknown) => toast({ tone: 'error', title, body: (e as Error).message });

  const toggleTracking = async (on: boolean) => {
    if (on) return router.push('/share-location');
    setBusy(true);
    await stopTracking().catch(fail('Could not stop sharing'));
    refresh();
    setBusy(false);
  };

  const setMode = async (mode: TrackingMode) => {
    if (!t?.running || t.mode === mode) return;
    await startTracking(mode).catch(fail('Could not change accuracy'));
    refresh();
  };

  const setPaused = async (paused: boolean) => {
    try {
      setMe(await api.post<Me>('/api/me/sharing', { paused }));
      qc.invalidateQueries({ queryKey: ['live'] });
      toast({ tone: paused ? 'info' : 'success', title: paused ? 'Sharing paused' : 'Sharing resumed', body: paused ? 'Your circles see that you paused, but not where you are.' : 'Your circles can see you again.' });
    } catch (e) {
      fail('Could not update sharing')(e);
    }
  };

  const togglePush = async (on: boolean) => {
    try {
      if (on) {
        await enablePush();
        toast({ tone: 'success', title: 'Notifications are on', body: 'Choose which alerts you want below.' });
      } else await disablePush();
    } catch (e) {
      fail('Notifications')(e);
    }
    refresh();
  };

  const savePrefs = async (preferences: Record<string, unknown>) => {
    try {
      setMe(await api.patch<Me>('/api/me', { preferences }));
    } catch (e) {
      fail('Could not save')(e);
    }
  };
  const setNotify = (key: NotifyKey, on: boolean) => savePrefs({ notifications: { ...notify, [key]: { ...notify[key], push: on } } });

  const chooseMapType = () =>
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Default map style', options: [...MAP_TYPES.map((m) => m.label), 'Cancel'], cancelButtonIndex: MAP_TYPES.length }, (i) => {
      const m = MAP_TYPES[i];
      if (!m) return;
      setMapType(m.type);
      void setMapTypePref(m.type);
    });

  const newCircle = () =>
    Alert.prompt('New circle', 'Family, roommates, a road trip…', async (name) => {
      if (!name?.trim()) return;
      try {
        const c = await api.post<{ id: string }>('/api/circles', { name: name.trim() });
        qc.invalidateQueries({ queryKey: ['circles'] });
        router.push(`/circle/${c.id}`);
      } catch (e) {
        fail('Could not create circle')(e);
      }
    });

  const joinCircle = () =>
    Alert.prompt('Join a circle', 'Paste the invitation link someone sent you.', async (link) => {
      const token = link?.trim().split('/join/').pop()?.split(/[?#]/)[0];
      if (!token) return;
      try {
        await api.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
        qc.invalidateQueries({ queryKey: ['circles'] });
        qc.invalidateQueries({ queryKey: ['live'] });
        toast({ tone: 'success', title: 'You joined the circle', body: 'They can now see your location, and you theirs.' });
      } catch (e) {
        fail('Could not join')(e);
      }
    });

  const removeDevice = (d: Device) =>
    Alert.alert(`Remove ${d.name}?`, 'It will stop sending locations. You can add it again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void api
            .del(`/api/devices/${d.id}`)
            .then(() => qc.invalidateQueries({ queryKey: ['devices'] }))
            .catch(fail('Could not remove device')),
      },
    ]);

  const openWeb = (path = '') => void WebBrowser.openBrowserAsync(`${server}${path}`);

  const permissionText = t?.background === 'granted' ? 'Always' : t?.foreground === 'granted' ? 'While using' : t?.foreground === 'denied' ? 'Off' : 'Not asked';
  const weekTrips = week.data ?? [];

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 120 }}>
      <ProfileCard me={me} circles={circles.length} places={places.length} trips={weekTrips.length} distance={formatDistance(weekTrips.reduce((s, x) => s + x.distanceM, 0), units)} />

      <HealthCard
        paused={me.sharingPaused}
        running={Boolean(t?.running)}
        always={t?.background === 'granted'}
        lastSent={upload.data?.last ?? null}
        pending={upload.data?.pending ?? 0}
        onFix={() => (me.sharingPaused ? void setPaused(false) : t?.running ? void Linking.openSettings() : router.push('/share-location'))}
      />

      <Section title="Location sharing" footer={`Last sent ${ago(upload.data?.last)}${upload.data?.pending ? ` · ${upload.data.pending} waiting to upload` : ''}. Locations go only to ${server?.replace(/^https?:\/\//, '') ?? 'your server'}.`}>
        <Row
          icon="location.fill"
          iconColor={t?.running ? '#34C759' : '#8E8E93'}
          title="Share from this iPhone"
          accessory={<Switch value={Boolean(t?.running)} disabled={busy} onValueChange={(v) => void toggleTracking(v)} trackColor={{ true: C.accent }} />}
        />
        <Row
          icon="pause.circle.fill"
          iconColor="#FF9500"
          title="Pause everywhere"
          subtitle="Hide your location from every circle until you turn this off"
          accessory={<Switch value={me.sharingPaused} onValueChange={(v) => void setPaused(v)} trackColor={{ true: C.orange }} />}
        />
        <Row icon="lock.shield.fill" iconColor="#007AFF" title="Location access" value={permissionText} onPress={() => void Linking.openSettings()} last />
      </Section>

      <Section title="Accuracy" footer={t?.running ? undefined : 'Turn on sharing to choose.'}>
        {(Object.keys(MODES) as TrackingMode[]).map((mode, i, all) => (
          <Row
            key={mode}
            icon={mode === 'precise' ? 'scope' : 'leaf.fill'}
            iconColor={mode === 'precise' ? '#5856D6' : '#34C759'}
            title={MODES[mode].label}
            subtitle={MODES[mode].detail}
            onPress={t?.running ? () => void setMode(mode) : undefined}
            accessory={t?.mode === mode ? <SymbolView name="checkmark" size={17} weight="semibold" tintColor={C.accent} /> : <View />}
            last={i === all.length - 1}
          />
        ))}
      </Section>

      <Section title="Circles" footer="Tap a circle to see members, invite people, or change what it can see.">
        {circles.map((c) => (
          <Row
            key={c.id}
            left={
              <View style={[styles.circleIcon, { backgroundColor: c.color }]}>
                <Text style={styles.circleInitial}>{c.name.trim()[0]?.toUpperCase()}</Text>
              </View>
            }
            title={c.name}
            subtitle={`${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'} · ${c.sharing ? 'sharing your location' : 'not sharing'}`}
            onPress={() => router.push(`/circle/${c.id}`)}
          />
        ))}
        <Row icon="plus" iconColor={C.accent as string} title="New circle" onPress={newCircle} />
        <Row icon="link" iconColor="#30B0C7" title="Join with an invite link" onPress={joinCircle} last />
      </Section>

      <Section title="Notifications" footer="Alerts you turn off here still show up in Alerts inside the app.">
        <Row icon="bell.badge.fill" iconColor="#FF3B30" title="Push notifications" accessory={<Switch value={pushOn} onValueChange={(v) => void togglePush(v)} trackColor={{ true: C.accent }} />} />
        {NOTIFY_TYPES.map((n) => (
          <Row
            key={n.key}
            icon={n.icon}
            iconColor={n.color}
            title={n.title}
            subtitle={n.subtitle}
            accessory={<Switch value={pushOn && notify[n.key]?.push !== false} disabled={!pushOn} onValueChange={(v) => void setNotify(n.key, v)} trackColor={{ true: C.accent }} />}
          />
        ))}
        <Row
          icon="battery.100percent.bolt"
          iconColor="#34C759"
          title="Warn my circles when my battery is low"
          subtitle={`At ${me.preferences.lowBatteryThreshold}% or less`}
          accessory={<Switch value={me.preferences.notifyLowBattery} onValueChange={(v) => void savePrefs({ notifyLowBattery: v })} trackColor={{ true: C.accent }} />}
          last
        />
      </Section>

      <Section title="Map & units">
        <Row
          icon="ruler.fill"
          iconColor="#34C759"
          title="Units"
          accessory={
            <Segmented
              value={units}
              onChange={(u) => void savePrefs({ units: u })}
              items={[
                { key: 'metric', label: 'km' },
                { key: 'imperial', label: 'mi' },
              ]}
              style={{ width: 120, height: 34 }}
            />
          }
        />
        <Row icon="map.fill" iconColor="#007AFF" title="Map style" value={MAP_TYPES.find((m) => m.type === mapType)?.label} onPress={chooseMapType} last />
      </Section>

      {!!devices.data?.length && (
        <Section title="Your devices" footer="Everything that sends your location to Nodara. Tap one to remove it.">
          {devices.data.map((d, i) => {
            const mine = d.id === thisDevice.data;
            return (
              <Row
                key={d.id}
                icon={deviceIcon(d.kind)}
                iconColor={mine ? (C.accent as string) : '#8E8E93'}
                title={mine ? `${d.name} (this iPhone)` : d.name}
                subtitle={`${deviceKind(d.kind)} · ${d.lastLocationAt ? `last location ${ago(d.lastLocationAt)}` : 'no locations yet'}`}
                onPress={mine ? undefined : () => removeDevice(d)}
                last={i === devices.data.length - 1}
              />
            );
          })}
        </Section>
      )}

      <Section title="Account & privacy">
        <Row icon="key.fill" iconColor="#8E8E93" title="Password & sign-in" value={me.totpEnabled ? '2FA on' : '2FA off'} onPress={() => openWeb('/settings/security')} />
        <Row icon="hand.raised.fill" iconColor="#5856D6" title="History & privacy" subtitle="Retention, who can see your history" onPress={() => openWeb('/settings/privacy')} />
        <Row icon="square.and.arrow.down.fill" iconColor="#30B0C7" title="Export my data" onPress={() => openWeb('/settings/data')} />
        <Row icon="safari.fill" iconColor="#007AFF" title="Open the web app" subtitle="History playback, insights, places editor, admin" onPress={() => openWeb()} last />
      </Section>

      <Section title="About" footer="Nodara is open source and was built mainly with AI by a non-professional developer. Please report anything that looks wrong.">
        <Row icon="info.circle.fill" iconColor="#8E8E93" title="App version" value={`${Application.nativeApplicationVersion ?? '—'} (${Application.nativeBuildVersion ?? '—'})`} />
        <Row icon="server.rack" iconColor="#8E8E93" title={config?.instanceName ?? 'Server'} value={config?.version ? `v${config.version}` : undefined} subtitle={server ?? undefined} />
        <Row icon="chevron.left.forwardslash.chevron.right" iconColor="#1C1C1E" title="Source code" subtitle="AGPL-3.0 on GitHub" onPress={() => void WebBrowser.openBrowserAsync(SOURCE_URL)} />
        <Row icon="hand.raised.fill" iconColor="#34C759" title="Privacy policy" onPress={() => openWeb('/privacy-policy')} last />
      </Section>

      <Section>
        <Row title="Sign out" destructive onPress={() => Alert.alert('Sign out?', 'This iPhone will stop sharing your location.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} />
        <Row title="Use a different server" destructive onPress={() => Alert.alert('Disconnect from this server?', 'You will be signed out and can connect to another Nodara server.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => void signOut().then(disconnect) }])} last />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  profile: { marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 28, borderCurve: 'continuous', backgroundColor: C.cell, gap: 18 },
  camera: { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: C.accent, borderWidth: 2.5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  statSep: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: C.separator },
  health: { marginHorizontal: 16, marginBottom: 28, padding: 18, borderRadius: 26, borderCurve: 'continuous', backgroundColor: C.cell, gap: 14, borderWidth: 1 },
  circleIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  circleInitial: { color: 'white', fontWeight: '800', fontSize: 14 },
});
