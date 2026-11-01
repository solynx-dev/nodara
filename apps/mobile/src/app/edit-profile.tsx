import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { appear } from '@/lib/motion';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AVATAR_COLORS, pickAndUploadAvatar, removeAvatar, type PhotoSource } from '@/lib/avatar';
import { useMe, useSession } from '@/lib/session';
import { C, T } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { Avatar, PrimaryButton, Tap, useToast } from '@/components/ui';

/** Name, photo and colour: what your circles see on the map and in their lists. */
export default function EditProfile() {
  const me = useMe();
  const { setMe } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.displayName);
  const [color, setColor] = useState(me.avatarColor);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== me.displayName || color !== me.avatarColor;

  const refreshEveryone = () => {
    qc.invalidateQueries({ queryKey: ['live'] });
    qc.invalidateQueries({ queryKey: ['circle'] });
  };

  const upload = async (source: PhotoSource) => {
    try {
      setUploading(true);
      const updated = await pickAndUploadAvatar(source);
      if (updated) {
        setMe(updated);
        refreshEveryone();
        toast({ tone: 'success', title: 'Photo updated', body: 'Your circles will see it on the map.' });
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update photo', body: (e as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    try {
      setUploading(true);
      setMe(await removeAvatar());
      refreshEveryone();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not remove photo', body: (e as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const changePhoto = () => {
    const options = ['Take photo', 'Choose from library', ...(me.avatarUrl ? ['Remove photo'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: me.avatarUrl ? 2 : undefined },
      (i) => {
        if (i === 0) void upload('camera');
        else if (i === 1) void upload('library');
        else if (i === 2 && me.avatarUrl) void remove();
      },
    );
  };

  const save = async () => {
    if (!name.trim()) return toast({ tone: 'error', title: 'Add your name', body: 'Your circles see it next to your location.' });
    try {
      setSaving(true);
      setMe(await api.patch<Me>('/api/me', { displayName: name.trim(), avatarColor: color }));
      refreshEveryone();
      toast({ tone: 'success', title: 'Profile saved' });
      router.back();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 26 }}>
        <Animated.View entering={appear} style={{ alignItems: 'center', gap: 14, marginTop: 8 }}>
          <Tap onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
            <Avatar name={name || me.displayName} color={color} url={me.avatarUrl} size={128} />
            <View style={styles.cameraBadge}>{uploading ? <ActivityIndicator color="white" /> : <SymbolView name="camera.fill" size={17} tintColor="white" />}</View>
          </Tap>
          <Tap onPress={changePhoto} haptic="none">
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.accent }}>{me.avatarUrl ? 'Change photo' : 'Add a photo'}</Text>
          </Tap>
        </Animated.View>

        <Animated.View entering={appear} style={{ gap: 8 }}>
          <Text style={styles.label}>NAME</Text>
          <View style={styles.field}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={C.tertiaryLabel}
              style={styles.input}
              maxLength={60}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="name"
              returnKeyType="done"
              clearButtonMode="while-editing"
            />
          </View>
          <Text style={styles.help}>Shown to everyone in your circles.</Text>
        </Animated.View>

        <Animated.View entering={appear} style={{ gap: 8 }}>
          <Text style={styles.label}>COLOUR</Text>
          <View style={[styles.field, styles.swatches]}>
            {AVATAR_COLORS.map((c) => {
              const on = c.toLowerCase() === color.toLowerCase();
              return (
                <Tap key={c} onPress={() => setColor(c)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Colour ${c}`} style={[styles.swatch, { backgroundColor: c }, on && styles.swatchOn]}>
                  {on && <SymbolView name="checkmark" size={16} weight="bold" tintColor="white" />}
                </Tap>
              );
            })}
          </View>
          <Text style={styles.help}>Used for your initials and map pin when you don&apos;t have a photo, and for your route on maps.</Text>
        </Animated.View>

        <PrimaryButton title="Save" onPress={() => void save()} loading={saving} disabled={!dirty} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, borderWidth: 3, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, color: C.secondaryLabel, marginLeft: 4 },
  help: { fontSize: 13, color: C.secondaryLabel, marginHorizontal: 4, lineHeight: 18 },
  field: { backgroundColor: C.cell, borderRadius: 18, borderCurve: 'continuous' },
  input: { ...T.body, color: C.label, paddingHorizontal: 16, paddingVertical: 15 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', padding: 14, rowGap: 12 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: 'white', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
});
