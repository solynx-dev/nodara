import { Alert, ScrollView, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { deviceSummary, type SessionInfo } from '@/lib/account';
import { ago } from '@/lib/format';
import { C } from '@/lib/theme';
import { PrimaryButton, Row, Section, Skeleton, useToast } from '@/components/ui';
import { FormHeader } from '@/components/forms';

/** Every browser and app signed in to your account; sign out the ones you don't recognise. */
export default function Sessions() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionInfo[]>('/api/auth/sessions') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sessions'] });
  const fail = (e: unknown) => toast({ tone: 'error', title: 'Could not sign out', body: (e as Error).message });

  const revoke = (s: SessionInfo) =>
    Alert.alert(`Sign out ${deviceSummary(s.userAgent).name}?`, 'It will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void api.del(`/api/auth/sessions/${s.id}`).then(refresh, fail) },
    ]);

  const revokeOthers = () =>
    Alert.alert('Sign out everywhere else?', 'Every other browser and app signed in to your account will need to sign in again. Phones keep sharing location.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out others',
        style: 'destructive',
        onPress: () =>
          void api
            .post('/api/auth/sessions/revoke-others')
            .then(() => {
              refresh();
              toast({ tone: 'success', title: 'Signed out everywhere else' });
            }, fail),
      },
    ]);

  const sessions = list.data ?? [];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
      <FormHeader icon="laptopcomputer.and.iphone" color="#30B0C7" title="Where you're signed in" body="Don't recognise one? Sign it out, then change your password." />
      {list.isLoading ? (
        <View style={{ marginHorizontal: 16 }}>
          <Skeleton height={150} />
        </View>
      ) : (
        <Section footer="Signing out a browser or app doesn't stop a phone from sharing its location. To stop that, remove the phone under Settings → Your devices.">
          {sessions.map((s, i) => {
            const d = deviceSummary(s.userAgent);
            return (
              <Row
                key={s.id}
                icon={d.icon}
                iconColor={s.current ? (C.accent as string) : '#8E8E93'}
                title={s.current ? `${d.name} (this iPhone)` : d.name}
                subtitle={`${s.current ? 'Active now' : `Active ${ago(s.lastSeenAt)}`}${s.ip ? ` · ${s.ip}` : ''} · signed in ${new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                onPress={s.current ? undefined : () => revoke(s)}
                last={i === sessions.length - 1}
              />
            );
          })}
        </Section>
      )}
      {sessions.length > 1 && (
        <View style={{ marginHorizontal: 16 }}>
          <PrimaryButton title="Sign out everywhere else" icon="rectangle.portrait.and.arrow.right" tone="plain" onPress={revokeOthers} />
        </View>
      )}
    </ScrollView>
  );
}
