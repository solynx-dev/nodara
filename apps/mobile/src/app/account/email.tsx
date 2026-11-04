import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import Animated from 'react-native-reanimated';
import { appear } from '@/lib/motion';
import { api } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { PrimaryButton, useToast } from '@/components/ui';
import { CodeInput, Field, FieldGroup, FormError, FormHeader } from '@/components/forms';

/**
 * Confirm your email, or move the account to a new one. A new address only
 * takes over once the code sent to it is entered here, and the old address
 * gets told either way.
 */
export default function EmailScreen() {
  const me = useMe();
  const { config, setMe } = useSession();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const emailOff = config?.emailEnabled === false;

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

  // -- Confirming a pending change ------------------------------------------------
  const confirmChange = (typed = code) =>
    run(async () => {
      const r = await api.post<{ user: Me }>('/api/me/email/confirm', { code: typed });
      setMe(r.user);
      setCode('');
      toast({ tone: 'success', title: 'Email changed', body: `You'll sign in with ${r.user.email} from now on.` });
    });
  const cancelChange = () =>
    run(async () => {
      const r = await api.del<{ user: Me }>('/api/me/email/pending');
      setMe(r.user);
      setCode('');
    });

  // -- Confirming the current address ---------------------------------------------------
  const sendVerification = () =>
    run(async () => {
      await api.post('/api/auth/resend-verification');
      setSent(true);
    });
  const verify = (typed = code) =>
    run(async () => {
      const r = await api.post<{ user?: Me }>('/api/auth/verify-email', { code: typed });
      if (r.user) setMe(r.user);
      else setMe({ ...me, emailVerified: true });
      setCode('');
      toast({ tone: 'success', title: 'Email confirmed' });
    });

  // -- Starting a change ---------------------------------------------------------------
  const requestChange = () =>
    run(async () => {
      const r = await api.post<{ changed: boolean; user: Me }>('/api/me/email', { email: newEmail.trim(), password });
      setMe(r.user);
      setNewEmail('');
      setPassword('');
      setCode('');
      if (r.changed) toast({ tone: 'success', title: 'Email changed', body: `You'll sign in with ${r.user.email} from now on.` });
    });

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
        {me.pendingEmail ? (
          <Animated.View key="pending" entering={appear}>
            <FormHeader icon="envelope.badge.fill" title="Check your new inbox" body={`Enter the 6-digit code we sent to ${me.pendingEmail}. Until then, you keep signing in with ${me.email}.`} />
            <CodeInput value={code} onChange={setCode} onComplete={(c) => void confirmChange(c)} />
            <FormError error={error} />
            <View style={{ marginHorizontal: 16, gap: 14 }}>
              <PrimaryButton title="Confirm new email" onPress={() => void confirmChange()} loading={busy} disabled={code.length < 6} />
              <Pressable onPress={() => void cancelChange()} disabled={busy} style={{ alignSelf: 'center', padding: 6 }}>
                <Text style={{ color: C.red, fontSize: 16 }}>Cancel the change</Text>
              </Pressable>
              <Text style={{ fontSize: 13, color: C.secondaryLabel, textAlign: 'center', lineHeight: 18 }}>
                Didn&apos;t get it? Check spam, or cancel and try again. The code expires after 24 hours.
              </Text>
            </View>
          </Animated.View>
        ) : (
          <Animated.View key="form" entering={appear}>
            {!me.emailVerified && !emailOff && (
              <>
                <FormHeader
                  icon="envelope.open.fill"
                  title="Confirm your email"
                  color="#FF9500"
                  body={sent ? `Enter the code we sent to ${me.email}.` : `Confirming ${me.email} lets you reset your password by email if you forget it.`}
                />
                {sent ? (
                  <>
                    <CodeInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} />
                    <View style={{ marginHorizontal: 16, gap: 12, marginBottom: 30 }}>
                      <PrimaryButton title="Confirm" onPress={() => void verify()} loading={busy} disabled={code.length < 6} />
                      <Pressable onPress={() => void sendVerification()} disabled={busy} style={{ alignSelf: 'center', padding: 6 }}>
                        <Text style={{ color: C.accentText, fontSize: 16, fontWeight: '600' }}>Send a new code</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <View style={{ marginHorizontal: 16, marginBottom: 30 }}>
                    <PrimaryButton title="Email me a code" icon="paperplane.fill" onPress={() => void sendVerification()} loading={busy} />
                  </View>
                )}
              </>
            )}

            <FieldGroup
              title="Change email"
              footer={
                emailOff
                  ? "This server can't send email, so the change happens as soon as you save."
                  : "We'll send a code to the new address. Your current email gets a heads-up, and nothing changes until you enter the code."
              }
            >
              <Field
                placeholder="New email"
                value={newEmail}
                onChangeText={setNewEmail}
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Field
                ref={passwordRef}
                placeholder="Current password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                returnKeyType="send"
                onSubmitEditing={() => void requestChange()}
                last
              />
            </FieldGroup>
            <FormError error={error} />
            <View style={{ marginHorizontal: 16 }}>
              <PrimaryButton
                title={emailOff ? 'Change email' : 'Send confirmation code'}
                onPress={() => void requestChange()}
                loading={busy}
                disabled={!/.+@.+\..+/.test(newEmail.trim()) || !password}
              />
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
