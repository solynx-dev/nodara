import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, type TextInputInstance } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { appear } from '@/lib/motion';
import { request } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import { PrimaryButton, useToast } from '@/components/ui';
import { CodeInput, Field, FieldGroup, FormError, FormHeader } from '@/components/forms';

type Step = 'email' | 'code' | 'password';

/**
 * Reset a forgotten password without leaving the app: email → 6-digit code →
 * new password. Works signed out (from the sign-in screen) and signed in (from
 * Account → Password). A reset signs out every device, so afterwards we sign
 * this iPhone straight back in.
 */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { me, config, signIn } = useSession();
  const toast = useToast();
  const wasSignedIn = Boolean(me);
  const [email, setEmail] = useState(params.email || me?.email || '');
  const [step, setStep] = useState<Step>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [noEmail, setNoEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<TextInputInstance>(null);

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

  const send = () =>
    run(async () => {
      const r = await request<{ emailEnabled: boolean }>('POST', '/api/auth/forgot-password', { email: email.trim() }, { token: null });
      if (!r.emailEnabled) return setNoEmail(true);
      setCode('');
      setStep('code');
    });

  const check = (typed = code) =>
    run(async () => {
      await request('POST', '/api/auth/reset-password/check', { email: email.trim(), code: typed }, { token: null });
      setStep('password');
    });

  const save = () =>
    run(async () => {
      if (password !== confirm) throw new Error("The passwords don't match.");
      await request('POST', '/api/auth/reset-password', { email: email.trim(), code, password }, { token: null });
      const r = await signIn(email.trim(), password).catch(() => null);
      toast({ tone: 'success', title: 'Password changed', body: 'Your other devices were signed out.' });
      if (r === 'ok' && wasSignedIn) router.back();
      else if (r === 'ok') router.replace('/');
      // Two-step accounts land on the sign-in screen's code step.
      else router.back();
    });

  const header =
    step === 'email'
      ? { icon: 'key.fill' as const, title: 'Reset your password', body: `We'll email a 6-digit code to the address on your ${config?.instanceName ?? 'Nodara'} account.` }
      : step === 'code'
        ? { icon: 'envelope.badge.fill' as const, title: 'Check your email', body: `If ${email.trim()} has an account, a code is on its way. It expires in 2 hours.` }
        : { icon: 'lock.rotation' as const, title: 'Choose a new password', body: 'At least 10 characters. Every device signed in to your account will be signed out.' };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text style={{ color: C.accent, fontSize: 17 }}>Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}>
        <Animated.View key={step} entering={appear}>
          <FormHeader icon={header.icon} title={header.title} body={header.body} />
          {step === 'email' && (
            <FieldGroup
              footer={
                noEmail
                  ? "This server can't send email yet. Ask your server's administrator for a reset link."
                  : undefined
              }
            >
              <Field
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={() => void send()}
                autoFocus={!email}
                last
              />
            </FieldGroup>
          )}
          {step === 'code' && <CodeInput value={code} onChange={setCode} onComplete={(c) => void check(c)} />}
          {step === 'password' && (
            <FieldGroup>
              <Field
                placeholder="New password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="new-password"
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
              />
              <Field
                ref={confirmRef}
                placeholder="Confirm new password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={() => void save()}
                last
              />
            </FieldGroup>
          )}
          <FormError error={error} />
          <Animated.View style={{ marginHorizontal: 16, gap: 14 }}>
            {step === 'email' && <PrimaryButton title="Send code" icon="paperplane.fill" onPress={() => void send()} loading={busy} disabled={!/.+@.+\..+/.test(email.trim())} />}
            {step === 'code' && (
              <>
                <PrimaryButton title="Continue" onPress={() => void check()} loading={busy} disabled={code.length < 6} />
                <Pressable onPress={() => void send()} disabled={busy} style={{ alignSelf: 'center', padding: 6 }}>
                  <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>Send a new code</Text>
                </Pressable>
              </>
            )}
            {step === 'password' && <PrimaryButton title="Save password" icon="checkmark" onPress={() => void save()} loading={busy} disabled={password.length < 10 || !confirm} />}
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
