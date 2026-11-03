import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { C } from '@/lib/theme';
import { PrimaryButton, useToast } from '@/components/ui';
import { Field, FieldGroup, FormError, FormHeader } from '@/components/forms';

/** Change your password, or reset it by email if you don't remember the current one. */
export default function PasswordScreen() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  const save = async () => {
    setError(null);
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      await api.post('/api/auth/password', { currentPassword: current, newPassword: next });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast({ tone: 'success', title: 'Password changed', body: 'Your other devices were signed out.' });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
        <FormHeader icon="key.fill" title="Change password" color="#8E8E93" body="Use at least 10 characters. Your other devices will be signed out; this iPhone stays signed in." />
        <FieldGroup>
          <Field
            placeholder="Current password"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
          />
          <Field
            ref={nextRef}
            placeholder="New password"
            value={next}
            onChangeText={setNext}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
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
        <FormError error={error} />
        <View style={{ marginHorizontal: 16, gap: 18 }}>
          <PrimaryButton title="Change password" onPress={() => void save()} loading={busy} disabled={!current || next.length < 10 || !confirm} />
          <Pressable onPress={() => router.push({ pathname: '/reset-password', params: { email: me.email } })} style={{ alignSelf: 'center', padding: 6 }}>
            <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>Forgot your password?</Text>
          </Pressable>
          <Text style={{ fontSize: 13, color: C.secondaryLabel, textAlign: 'center', lineHeight: 18 }}>
            We&apos;ll email a code to {me.email} so you can choose a new one.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
