import { ActionSheetIOS, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQuery } from '@tanstack/react-query';
import { appear } from '@/lib/motion';
import { api } from '@/lib/api';
import { exportData, type ExportFormat, type PasskeyInfo, type SessionInfo } from '@/lib/account';
import { useMe, useSession } from '@/lib/session';
import { retentionLabel } from '@/lib/format';
import { C, HEX, T } from '@/lib/theme';
import { Avatar, Row, Section, Tap, useToast } from '@/components/ui';

/**
 * Everything about your account in one place: profile, email, password,
 * two-step verification, passkeys, where you're signed in, your history and
 * data, signing out and deleting the account. No trip to the web app needed.
 */
export default function Account() {
  const me = useMe();
  const { config, server, signOut, disconnect } = useSession();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionInfo[]>('/api/auth/sessions') });
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<PasskeyInfo[]>('/api/auth/passkeys') });

  const emailState = me.pendingEmail
    ? { text: `Changing to ${me.pendingEmail}`, color: HEX.orange }
    : me.emailVerified
      ? { text: 'Verified', color: HEX.green }
      : { text: 'Not confirmed', color: HEX.orange };

  const exportSheet = () => {
    const options: [ExportFormat, string][] = [
      ['json', 'Everything (JSON)'],
      ['gpx', 'Location track (GPX)'],
      ['csv', 'Spreadsheet (CSV)'],
      ['geojson', 'Map data (GeoJSON)'],
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Export your data', message: 'Your profile, circles, places, trips and every location point, in an open format.', options: [...options.map((o) => o[1]), 'Cancel'], cancelButtonIndex: options.length },
      (i) => {
        const f = options[i];
        if (f) exportData(f[0]).catch((e: Error) => toast({ tone: 'error', title: 'Export failed', body: e.message }));
      },
    );
  };

  const deleteAccount = () =>
    Alert.alert('Delete your account?', 'This removes your account, devices, location history, trips and places for good. Circles you own pass to another member.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () =>
          Alert.prompt(
            'Enter your password',
            'Deleting cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete forever',
                style: 'destructive',
                onPress: async (password?: string) => {
                  try {
                    await api.del('/api/me', { password: password ?? '', confirm: 'DELETE' });
                    await signOut();
                  } catch (e) {
                    toast({ tone: 'error', title: 'Account not deleted', body: (e as Error).message });
                  }
                },
              },
            ],
            'secure-text',
          ),
      },
    ]);

  const otherSessions = (sessions.data ?? []).filter((s) => !s.current).length;
  const host = server?.replace(/^https?:\/\//, '');

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 80 }}>
      <Animated.View entering={appear} style={styles.header}>
        <Tap onPress={() => router.push('/edit-profile')} accessibilityRole="button" accessibilityLabel="Edit name and photo">
          <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={96} />
          <View style={styles.camera}>
            <SymbolView name="camera.fill" size={13} tintColor="white" />
          </View>
        </Tap>
        <Text style={[T.title1, { color: C.label, textAlign: 'center' }]} numberOfLines={1}>
          {me.displayName}
        </Text>
        <Text style={[T.subhead, { color: C.secondaryLabel }]} numberOfLines={1}>
          {me.email} · {host}
        </Text>
      </Animated.View>

      {!me.emailVerified && !me.pendingEmail && (
        <Animated.View entering={appear}>
          <Tap onPress={() => router.push('/account/email')} style={styles.banner}>
            <SymbolView name="envelope.badge.fill" size={22} tintColor={HEX.orange} />
            <View style={{ flex: 1 }}>
              <Text style={[T.headline, { color: C.label }]}>Confirm your email</Text>
              <Text style={[T.footnote, { color: C.secondaryLabel }]}>So you can reset your password if you ever forget it.</Text>
            </View>
            <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />
          </Tap>
        </Animated.View>
      )}

      <Section title="Profile">
        <Row icon="person.crop.circle.fill" iconColor="#FF9500" title="Name, photo & colour" subtitle="What your circles see on the map" onPress={() => router.push('/edit-profile')} />
        <Row
          icon="envelope.fill"
          iconColor="#007AFF"
          title="Email"
          subtitle={
            <Text>
              {me.email} · <Text style={{ color: emailState.color }}>{emailState.text}</Text>
            </Text>
          }
          onPress={() => router.push('/account/email')}
          last
        />
      </Section>

      <Section title="Sign-in & security" footer="You'll get an email whenever your password, two-step verification or passkeys change.">
        <Row icon="key.fill" iconColor="#8E8E93" title="Password" subtitle="Change it, or reset it by email" onPress={() => router.push('/account/password')} />
        <Row
          icon="lock.shield.fill"
          iconColor="#34C759"
          title="Two-step verification"
          value={me.totpEnabled ? 'On' : 'Off'}
          onPress={() => router.push('/account/two-factor')}
        />
        <Row icon="person.badge.key.fill" iconColor="#5856D6" title="Passkeys" value={passkeys.data ? String(passkeys.data.length) : undefined} onPress={() => router.push('/account/passkeys')} />
        <Row
          icon="laptopcomputer.and.iphone"
          iconColor="#30B0C7"
          title="Where you're signed in"
          value={sessions.data ? (otherSessions ? `${otherSessions + 1} devices` : 'Only here') : undefined}
          onPress={() => router.push('/account/sessions')}
          last
        />
      </Section>

      <Section title="History & privacy" footer={`Your history lives on ${host ?? 'your server'}. You decide how long it's kept.`}>
        <Row icon="clock.arrow.circlepath" iconColor="#5856D6" title="Keep my history" value={retentionLabel(me.preferences.retentionDays, config?.defaultRetentionDays ?? null)} onPress={() => router.push('/account/privacy')} />
        <Row icon="trash.fill" iconColor="#FF3B30" title="Delete history" subtitle="The last hour, today, a week, or everything" onPress={() => router.push('/account/privacy')} />
        <Row icon="square.and.arrow.up.fill" iconColor="#30B0C7" title="Export your data" subtitle="JSON, GPX, CSV or GeoJSON" onPress={exportSheet} last />
      </Section>

      <Section>
        <Row
          title="Sign out"
          destructive
          onPress={() => Alert.alert('Sign out?', 'This iPhone will stop sharing your location.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])}
        />
        <Row
          title="Use a different server"
          destructive
          onPress={() =>
            Alert.alert('Disconnect from this server?', 'You will be signed out and can connect to another Nodara server.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Disconnect', style: 'destructive', onPress: () => void signOut().then(disconnect) },
            ])
          }
          last
        />
      </Section>

      <Section footer="Removes your account and everything in it from this server.">
        <Row title="Delete account" destructive onPress={deleteAccount} last />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 6, paddingHorizontal: 24, paddingBottom: 26 },
  camera: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, borderWidth: 2.5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 24, padding: 16, borderRadius: 22, borderCurve: 'continuous', backgroundColor: C.cell, borderWidth: 1, borderColor: `${HEX.orange}55` },
});
