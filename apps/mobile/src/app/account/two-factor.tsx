import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { appear } from '@/lib/motion';
import { api } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { C, HEX, T } from '@/lib/theme';
import { PrimaryButton, Row, Section, useToast } from '@/components/ui';
import { CodeInput, FormError, FormHeader } from '@/components/forms';

type Setup = { secret: string; uri: string; qr?: string };

/**
 * Two-step verification with an authenticator app (iOS Passwords, 1Password,
 * Google Authenticator…): set it up, save recovery codes, or turn it off.
 */
export default function TwoFactor() {
  const me = useMe();
  const { setMe } = useSession();
  const toast = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setSetup(await api.post<Setup>('/api/auth/totp/setup')));
  const enable = (typed = code) =>
    run(async () => {
      const r = await api.post<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { code: typed });
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      setMe({ ...me, totpEnabled: true });
    });

  const turnOff = () =>
    Alert.prompt(
      'Turn off two-step verification?',
      'Enter your password. Signing in will only need your password (or a passkey).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: (password?: string) =>
            void run(async () => {
              await api.post('/api/auth/totp/disable', { password: password ?? '' });
              setMe({ ...me, totpEnabled: false });
              toast({ tone: 'info', title: 'Two-step verification is off' });
            }),
        },
      ],
      'secure-text',
    );

  const openAuthenticator = async () => {
    if (!setup) return;
    try {
      await Linking.openURL(setup.uri);
    } catch {
      toast({ tone: 'info', title: 'No authenticator app found', body: 'Copy the setup key and paste it into your authenticator app.' });
    }
  };

  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    toast({ tone: 'success', title: `${what} copied` });
  };

  // Recovery codes, shown once right after turning it on.
  if (codes) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
        <Animated.View entering={appear}>
          <FormHeader icon="checkmark.shield.fill" color={HEX.green} title="Save your recovery codes" body="Each code signs you in once if you lose your authenticator. Keep them somewhere safe; they won't be shown again." />
          <View style={styles.codes}>
            {codes.map((c) => (
              <Text key={c} style={styles.codeText} selectable>
                {c}
              </Text>
            ))}
          </View>
          <View style={{ marginHorizontal: 16, gap: 12 }}>
            <PrimaryButton title="Copy codes" icon="doc.on.doc" tone="plain" onPress={() => void copy(codes.join('\n'), 'Recovery codes')} />
            <PrimaryButton title="Save or share…" icon="square.and.arrow.up" tone="plain" onPress={() => void Share.share({ message: `Nodara recovery codes for ${me.email}:\n\n${codes.join('\n')}` })} />
            <PrimaryButton title="Done" onPress={() => router.back()} />
          </View>
        </Animated.View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
        {me.totpEnabled ? (
          <Animated.View key="on" entering={appear}>
            <FormHeader icon="lock.shield.fill" color={HEX.green} title="Two-step verification is on" body="Signing in with your password also needs a code from your authenticator app. Passkeys don't need a code." />
            <Section footer="Lost your authenticator? Sign in with one of your recovery codes instead of a code.">
              <Row title="Turn off two-step verification" destructive onPress={turnOff} last />
            </Section>
          </Animated.View>
        ) : setup ? (
          <Animated.View key="setup" entering={appear}>
            <FormHeader icon="qrcode" title="Add Nodara to your authenticator" body="Then enter the 6-digit code it shows to finish." />
            <Section title="On this iPhone">
              <Row icon="arrow.up.forward.app.fill" iconColor="#007AFF" title="Open in authenticator app" subtitle="iOS Passwords, 1Password, Authy…" onPress={() => void openAuthenticator()} />
              <Row icon="doc.on.doc.fill" iconColor="#8E8E93" title="Copy setup key" subtitle={setup.secret.replace(/(.{4})/g, '$1 ').trim()} onPress={() => void copy(setup.secret, 'Setup key')} last />
            </Section>
            {setup.qr && (
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <Text style={[styles.label, { alignSelf: 'stretch' }]}>ON ANOTHER DEVICE, SCAN</Text>
                <View style={styles.qrBox}>
                  <Image source={{ uri: setup.qr }} style={{ width: 184, height: 184 }} contentFit="contain" accessibilityLabel="Authenticator QR code" />
                </View>
              </View>
            )}
            <Text style={styles.label}>CODE FROM YOUR AUTHENTICATOR</Text>
            <CodeInput value={code} onChange={setCode} onComplete={(c) => void enable(c)} autoFocus={false} />
            <FormError error={error} />
            <View style={{ marginHorizontal: 16 }}>
              <PrimaryButton title="Turn on" onPress={() => void enable()} loading={busy} disabled={code.length < 6} />
            </View>
          </Animated.View>
        ) : (
          <Animated.View key="off" entering={appear}>
            <FormHeader
              icon="lock.shield"
              title="Protect your account"
              body="With two-step verification, signing in with your password also needs a code from an authenticator app, so a leaked password isn't enough."
            />
            <FormError error={error} />
            <View style={{ marginHorizontal: 16 }}>
              <PrimaryButton title="Set up two-step verification" icon="lock.shield.fill" onPress={() => void start()} loading={busy} />
            </View>
            <Text style={[T.footnote, { color: C.secondaryLabel, textAlign: 'center', marginHorizontal: 32, marginTop: 16, lineHeight: 18 }]}>
              Tip: passkeys are just as safe and don&apos;t need codes.
            </Text>
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: C.secondaryLabel, marginHorizontal: 20, marginBottom: 6 },
  qrBox: { padding: 12, borderRadius: 20, backgroundColor: 'white' },
  codes: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 16, marginBottom: 20, padding: 12, gap: 8, borderRadius: 22, backgroundColor: C.cell, justifyContent: 'center' },
  codeText: { width: '45%', textAlign: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: C.fill, color: C.label, fontSize: 16, fontFamily: 'Menlo', fontWeight: '600' },
});
