import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';
import { startTracking } from '@/background/tracking';
import { C } from '@/lib/theme';
import { PrimaryButton } from '@/components/ui';

/** Explains what will happen before iOS shows its location prompts. */
export default function ShareLocation() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'always' | 'foreground' | 'denied' | null>(null);

  const start = async () => {
    setBusy(true);
    try {
      const r = await startTracking('balanced');
      setResult(r);
      qc.invalidateQueries({ queryKey: ['tracking'] });
      if (r === 'always') router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 36, gap: 22 }}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <SymbolView name="location.circle.fill" size={64} tintColor={C.accent} type="hierarchical" />
        <Text style={{ fontSize: 26, fontWeight: '800', color: C.label, textAlign: 'center' }}>Share your location</Text>
      </View>
      <Point icon="lock.shield.fill" title="Only on your server" body="Locations go straight to your Nodara server — never to us or advertisers." />
      <Point icon="person.2.fill" title="Only your circles" body="Just the circles you choose can see you. Pause any time from Settings." />
      <Point icon="moon.zzz.fill" title="Works in the background" body={'Choose "Allow While Using App" first, then "Change to Always Allow" when iOS asks, so your family still sees you when Nodara is closed.'} />
      {result === 'foreground' && (
        <Text style={{ color: C.orange, fontSize: 14, lineHeight: 20 }}>
          Sharing only while Nodara is open. To share in the background, open Settings → Nodara → Location and choose “Always”.
        </Text>
      )}
      {result === 'denied' && <Text style={{ color: C.red, fontSize: 14 }}>Location access is off for Nodara. You can turn it on in iOS Settings.</Text>}
      {result && result !== 'always' ? (
        <PrimaryButton title="Open iOS Settings" icon="gear" onPress={() => void Linking.openSettings()} />
      ) : (
        <PrimaryButton title="Continue" icon="location.fill" onPress={start} loading={busy} />
      )}
    </ScrollView>
  );
}

function Point({ icon, title, body }: { icon: SFSymbol; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <SymbolView name={icon} size={26} tintColor={C.accent} style={{ width: 32 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: C.label }}>{title}</Text>
        <Text style={{ fontSize: 15, color: C.secondaryLabel, lineHeight: 20 }}>{body}</Text>
      </View>
    </View>
  );
}
