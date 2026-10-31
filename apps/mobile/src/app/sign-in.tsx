import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import { PrimaryButton, styles } from '@/components/ui';

export default function SignIn() {
  const { server, config, signIn, verifyCode, disconnect } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (step === 'password') {
        if ((await signIn(email.trim(), password)) === '2fa') setStep('code');
      } else {
        await verifyCode(code.trim());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const host = server?.replace(/^https?:\/\//, '');
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 34, fontWeight: '800', color: C.label, letterSpacing: -0.5 }}>
            {step === 'password' ? 'Sign in' : 'Verification'}
          </Text>
          <Text style={{ fontSize: 16, color: C.secondaryLabel }}>
            {step === 'password' ? `to ${config?.instanceName ?? 'Nodara'} · ${host}` : 'Enter the code from your authenticator app, or a recovery code.'}
          </Text>
        </View>
        <View style={[styles.section, { marginHorizontal: 0 }]}>
          {step === 'password' ? (
            <>
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
                onSubmitEditing={submit}
              />
            </>
          ) : (
            <TextInput
              style={styles.input}
              placeholder="123456"
              placeholderTextColor={C.tertiaryLabel as string}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoFocus
              onSubmitEditing={submit}
            />
          )}
        </View>
        {error && <Text style={{ color: C.red, fontSize: 14 }}>{error}</Text>}
        <PrimaryButton title={step === 'password' ? 'Sign in' : 'Verify'} onPress={submit} loading={busy} disabled={step === 'password' ? !email || !password : code.length < 6} />
        <Text style={{ fontSize: 13, color: C.secondaryLabel, textAlign: 'center', lineHeight: 19 }}>
          New to this server? Open your invitation link in Safari to create an account, then sign in here.
        </Text>
        <Pressable onPress={disconnect} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <SymbolView name="server.rack" size={14} tintColor={C.accent} />
          <Text style={{ color: C.accent, fontSize: 15 }}>Use a different server</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
