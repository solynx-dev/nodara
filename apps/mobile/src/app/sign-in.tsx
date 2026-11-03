import { useState } from 'react';
import Animated from 'react-native-reanimated';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { appear } from '@/lib/motion';
import { request } from '@/lib/api';
import { passkeysAvailable } from '@/lib/account';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import { PrimaryButton, styles, useToast } from '@/components/ui';
import { CodeInput, FormError } from '@/components/forms';

type Step = 'password' | 'code' | 'verify';

export default function SignIn() {
  const { server, config, signIn, signInWithPasskey, pending2fa, verifyCode, disconnect } = useSession();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Straight to the code step when a password reset left a two-step sign-in waiting.
  const [step, setStep] = useState<Step>(pending2fa ? 'code' : 'password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPasskey = passkeysAvailable(config);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const submit = (typed = code) =>
    run(async () => {
      if (step === 'password') {
        const r = await signIn(email.trim(), password);
        if (r === '2fa') setStep('code');
        if (r === 'verify') {
          setCode('');
          setStep('verify');
        }
      } else if (step === 'code') {
        await verifyCode(typed.trim());
      } else {
        // Confirm the email with the emailed code, then finish signing in.
        await request('POST', '/api/auth/verify-email', { email: email.trim(), code: typed }, { token: null });
        const r = await signIn(email.trim(), password);
        if (r === '2fa') setStep('code');
      }
    });

  const resend = () =>
    run(async () => {
      await request('POST', '/api/auth/resend-verification', { email: email.trim() }, { token: null });
      toast({ tone: 'success', title: 'New code sent', body: `Check ${email.trim()}.` });
    });

  const passkey = () => run(async () => void (await signInWithPasskey()));

  const host = server?.replace(/^https?:\/\//, '');
  const titles: Record<Step, [string, string]> = {
    password: ['Sign in', `to ${config?.instanceName ?? 'Nodara'} · ${host}`],
    code: ['Two-step verification', 'Enter the code from your authenticator app, or a recovery code.'],
    verify: ['Confirm your email', `We sent a 6-digit code to ${email.trim()}. Enter it to finish signing in.`],
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
        <Animated.View key={`t-${step}`} entering={appear} style={{ gap: 8 }}>
          <Text style={{ fontSize: 34, fontWeight: '800', color: C.label, letterSpacing: -0.5 }}>{titles[step][0]}</Text>
          <Text style={{ fontSize: 16, color: C.secondaryLabel, lineHeight: 22 }}>{titles[step][1]}</Text>
        </Animated.View>
        <Animated.View key={step} entering={appear}>
          {step === 'password' ? (
            <View style={[styles.section, { marginHorizontal: 0 }]}>
              <TextInput
                style={[styles.input, { borderBottomWidth: 0.5, borderBottomColor: C.separator }]}
                placeholder="Email"
                placeholderTextColor={C.tertiaryLabel as string}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                keyboardType="email-address"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={C.tertiaryLabel as string}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
            </View>
          ) : step === 'code' ? (
            <View style={[styles.section, { marginHorizontal: 0 }]}>
              <TextInput
                style={[styles.input, { fontSize: 22, letterSpacing: 4, textAlign: 'center' }]}
                placeholder="123456"
                placeholderTextColor={C.tertiaryLabel as string}
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                textContentType="oneTimeCode"
                autoFocus
                onSubmitEditing={() => void submit()}
              />
            </View>
          ) : (
            <View style={{ marginHorizontal: -16 }}>
              <CodeInput value={code} onChange={setCode} onComplete={(c) => void submit(c)} />
            </View>
          )}
        </Animated.View>
        {error && (
          <View style={{ marginHorizontal: -20 }}>
            <FormError error={error} />
          </View>
        )}
        <PrimaryButton
          title={step === 'password' ? 'Sign in' : step === 'code' ? 'Verify' : 'Confirm & sign in'}
          onPress={() => void submit()}
          loading={busy}
          disabled={step === 'password' ? !email || !password : code.length < 6}
        />
        {step === 'password' && (
          <>
            <Pressable onPress={() => router.push({ pathname: '/reset-password', params: { email: email.trim() } })} style={{ alignSelf: 'center', padding: 4 }}>
              <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>Forgot password?</Text>
            </Pressable>
            {canPasskey && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: C.separator }} />
                  <Text style={{ color: C.secondaryLabel, fontSize: 13 }}>or</Text>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: C.separator }} />
                </View>
                <PrimaryButton title="Sign in with a passkey" icon="person.badge.key.fill" tone="plain" onPress={() => void passkey()} disabled={busy} />
              </>
            )}
          </>
        )}
        {step === 'verify' && (
          <Pressable onPress={() => void resend()} disabled={busy} style={{ alignSelf: 'center', padding: 4 }}>
            <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>Send a new code</Text>
          </Pressable>
        )}
        {step !== 'password' && (
          <Pressable
            onPress={() => {
              setStep('password');
              setCode('');
              setError(null);
            }}
            style={{ alignSelf: 'center', padding: 4 }}
          >
            <Text style={{ color: C.secondaryLabel, fontSize: 15 }}>Back</Text>
          </Pressable>
        )}
        {step === 'password' && (
          <>
            <Text style={{ fontSize: 13, color: C.secondaryLabel, textAlign: 'center', lineHeight: 19 }}>
              New to this server? Open your invitation link in Safari to create an account, then sign in here.
            </Text>
            <Pressable onPress={disconnect} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <SymbolView name="server.rack" size={14} tintColor={C.accent} />
              <Text style={{ color: C.accent, fontSize: 15 }}>Use a different server</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
