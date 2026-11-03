import { useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, View } from 'react-native';
import * as Device from 'expo-device';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { createPasskey, passkeysAvailable, type PasskeyInfo } from '@/lib/account';
import { useSession } from '@/lib/session';
import { ago } from '@/lib/format';
import { C } from '@/lib/theme';
import { Empty, PrimaryButton, Row, Section, Skeleton, useToast } from '@/components/ui';
import { FormHeader } from '@/components/forms';

/** Sign in with Face ID instead of a password. Passkeys are saved in iCloud Keychain. */
export default function Passkeys() {
  const { config, server } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<PasskeyInfo[]>('/api/auth/passkeys') });
  const canAdd = passkeysAvailable(config);
  const host = server?.replace(/^https?:\/\//, '') ?? 'this server';

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['passkeys'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const fail = (title: string) => (e: unknown) => toast({ tone: 'error', title, body: (e as Error).message });

  const add = () =>
    Alert.prompt(
      'Name this passkey',
      'So you can tell your passkeys apart later.',
      async (name?: string) => {
        setBusy(true);
        try {
          if (await createPasskey(name?.trim() || Device.deviceName || 'iPhone')) {
            refresh();
            toast({ tone: 'success', title: 'Passkey added', body: 'Next time, sign in with Face ID.' });
          }
        } catch (e) {
          fail('Could not add passkey')(e);
        } finally {
          setBusy(false);
        }
      },
      'plain-text',
      Device.deviceName ?? 'iPhone',
    );

  const manage = (p: PasskeyInfo) =>
    ActionSheetIOS.showActionSheetWithOptions({ title: p.name, options: ['Rename', 'Remove', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (i) => {
      if (i === 0) {
        Alert.prompt(
          'Rename passkey',
          undefined,
          (name?: string) => {
            if (!name?.trim()) return;
            api.patch(`/api/auth/passkeys/${encodeURIComponent(p.id)}`, { name: name.trim() }).then(refresh, fail('Could not rename'));
          },
          'plain-text',
          p.name,
        );
      }
      if (i === 1) {
        Alert.alert(`Remove “${p.name}”?`, 'It will stop working for signing in. It may still show in your Passwords app until you delete it there.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => void api.del(`/api/auth/passkeys/${encodeURIComponent(p.id)}`).then(refresh, fail('Could not remove')) },
        ]);
      }
    });

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
      <FormHeader icon="person.badge.key.fill" color="#5856D6" title="Passkeys" body="Sign in with Face ID or Touch ID instead of a password. Passkeys can't be phished or leaked." />
      {list.isLoading ? (
        <View style={{ marginHorizontal: 16 }}>
          <Skeleton height={104} />
        </View>
      ) : list.data?.length ? (
        <Section footer="Tap a passkey to rename or remove it.">
          {list.data.map((p, i) => (
            <Row
              key={p.id}
              icon="person.badge.key.fill"
              iconColor="#5856D6"
              title={p.name}
              subtitle={`Added ${new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${p.lastUsedAt ? `used ${ago(p.lastUsedAt)}` : 'never used'}`}
              onPress={() => manage(p)}
              last={i === list.data.length - 1}
            />
          ))}
        </Section>
      ) : (
        <Empty icon="key.viewfinder" title="No passkeys yet" body={canAdd ? 'Add one to sign in with Face ID.' : undefined} />
      )}
      <View style={{ marginHorizontal: 16 }}>
        {canAdd ? (
          <PrimaryButton title="Add a passkey" icon="plus" onPress={add} loading={busy} />
        ) : (
          <Section footer={`Apple only lets the Nodara app create passkeys for the official servers. Add a passkey for ${host} from the web app in Safari; it'll sync to this iPhone through iCloud Keychain.`}>
            <Row icon="info.circle.fill" iconColor="#8E8E93" title="Not available for this server" last />
          </Section>
        )}
      </View>
    </ScrollView>
  );
}
