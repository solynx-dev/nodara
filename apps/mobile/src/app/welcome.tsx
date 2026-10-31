import { useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';
import { PrimaryButton, styles } from '@/components/ui';

export default function Welcome() {
  const { connect } = useSession();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 28 }} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.springify().damping(16)} style={{ alignItems: 'center', gap: 14 }}>
          <Image source={require('../../assets/icon.png')} style={{ width: 96, height: 96, borderRadius: 22 }} />
          <Text style={{ fontSize: 34, fontWeight: '800', color: C.label, letterSpacing: -0.5 }}>Nodara</Text>
          <Text style={{ fontSize: 17, color: C.secondaryLabel, textAlign: 'center', lineHeight: 23 }}>
            Your people. Your places. Your data.{'\n'}Connect to your family&apos;s Nodara server.
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(120).springify()} style={{ gap: 8 }}>
          <View style={[styles.section, { marginHorizontal: 0 }]}>
            <TextInput
              style={styles.input}
              placeholder="nodara.example.com"
              placeholderTextColor={C.tertiaryLabel as string}
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          </View>
          {error && <Text style={{ color: C.red, fontSize: 14, marginHorizontal: 4 }}>{error}</Text>}
          <Text style={{ color: C.secondaryLabel, fontSize: 13, marginHorizontal: 4 }}>The address of your family&apos;s Nodara server, e.g. nodara.example.com. Ask whoever set it up.</Text>
        </Animated.View>
        <PrimaryButton title="Continue" onPress={submit} loading={busy} disabled={!address.trim()} />
        <Text style={{ fontSize: 13, color: C.secondaryLabel, textAlign: 'center', lineHeight: 19 }}>
          Nodara is self-hosted: your locations go only to the server you enter here.{' '}
          <Text style={{ color: C.accent }} onPress={() => Linking.openURL('https://github.com/solynx-dev/nodara#quick-start-docker-compose')}>
            Set up your own server
          </Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
