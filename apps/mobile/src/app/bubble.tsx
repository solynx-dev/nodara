import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle as MapCircle } from 'react-native-maps';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Location from 'expo-location';
import { useQueryClient } from '@tanstack/react-query';
import { appear } from '@/lib/motion';
import { api } from '@/lib/api';
import { useBubble } from '@/lib/queries';
import { useMe } from '@/lib/session';
import { clock, formatDistance } from '@/lib/format';
import { BUBBLE_COLOR, bubbleArea } from '@/lib/status';
import { C, T } from '@/lib/theme';
import type { BubbleState } from '@/lib/types';
import { PrimaryButton, Segmented, useToast } from '@/components/ui';
import { FormError } from '@/components/forms';

const SIZES = [
  { key: 'near', label: 'Nearby', radiusM: 1_000 },
  { key: 'town', label: 'Town', radiusM: 5_000 },
  { key: 'city', label: 'City', radiusM: 15_000 },
  { key: 'region', label: 'Region', radiusM: 40_000 },
] as const;
const HOURS = [
  { key: '1', label: '1 hr', hours: 1 },
  { key: '2', label: '2 hr', hours: 2 },
  { key: '4', label: '4 hr', hours: 4 },
  { key: '8', label: '8 hr', hours: 8 },
] as const;
type SizeKey = (typeof SIZES)[number]['key'];
type HourKey = (typeof HOURS)[number]['key'];

/**
 * Bubble: for a few hours, your circles see a general area around you instead
 * of where you are exactly. They still see your battery, and that you're OK.
 */
export default function BubbleSheet() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const state = useBubble();
  const units = me.preferences.units;
  const [size, setSize] = useState<SizeKey>('town');
  const [hours, setHours] = useState<HourKey>('2');
  const [editing, setEditing] = useState(false);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) setHere({ lat: last.coords.latitude, lon: last.coords.longitude });
      const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (now) setHere({ lat: now.coords.latitude, lon: now.coords.longitude });
    })();
  }, []);

  const bubble = state.data?.bubble ?? null;
  const circles = state.data?.circles ?? [];
  const covered = circles.filter((c) => c.allowed);
  const exempt = circles.filter((c) => !c.allowed);
  const radiusM = SIZES.find((s) => s.key === size)!.radiusM;
  const choosing = !bubble || editing;

  // Preview the size you're choosing around you (the real centre is shifted a little so it doesn't point at you).
  const preview = choosing ? (here ? { ...here, radiusM } : null) : bubble ? { lat: bubble.lat, lon: bubble.lon, radiusM: bubble.radiusM } : null;
  // (React Compiler memoizes this, so the preview map isn't re-centred on every render.)
  const delta = preview ? (preview.radiusM * 2.8) / 111_000 : 0;
  const region = preview ? { latitude: preview.lat, longitude: preview.lon, latitudeDelta: delta, longitudeDelta: delta } : undefined;

  const done = (next: BubbleState) => {
    qc.setQueryData(['bubble'], next);
    qc.invalidateQueries({ queryKey: ['live'] });
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<BubbleState>('/api/bubble', { radiusM, hours: HOURS.find((h) => h.key === hours)!.hours, ...(here ?? {}) });
      done(next);
      setEditing(false);
      toast({ tone: 'success', title: 'Bubble on', body: `Until ${clock(next.bubble!.endsAt)}. Your circles see ${next.bubble!.label ? `"around ${next.bubble!.label}"` : 'a general area'}.` });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      done(await api.del<BubbleState>('/api/bubble'));
      toast({ tone: 'info', title: 'Bubble ended', body: 'Your circles can see your location again.' });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ padding: 20, paddingTop: 26, gap: 16, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.icon}>
          <SymbolView name="circle.dashed.inset.filled" size={26} tintColor={BUBBLE_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[T.title2, { color: C.label }]}>{bubble && !editing ? 'Bubble is on' : 'Bubble'}</Text>
          <Text style={[T.subhead, { color: C.secondaryLabel }]}>
            {bubble && !editing ? `Until ${clock(bubble.endsAt)}` : 'Show your circles only a general area for a while.'}
          </Text>
        </View>
      </View>

      <View style={styles.map}>
        {region ? (
          <MapView style={StyleSheet.absoluteFill} region={region} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} showsUserLocation={choosing} pointerEvents="none">
            {preview && (
              <MapCircle center={{ latitude: preview.lat, longitude: preview.lon }} radius={preview.radiusM} strokeColor={`${BUBBLE_COLOR}CC`} strokeWidth={2} lineDashPattern={[8, 6]} fillColor={`${BUBBLE_COLOR}2E`} />
            )}
          </MapView>
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[T.footnote, { color: C.secondaryLabel }]}>Finding you…</Text>
          </View>
        )}
      </View>

      {choosing ? (
        <Animated.View key="choose" entering={appear} style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>AREA</Text>
            <Segmented value={size} onChange={setSize} items={SIZES.map((s) => ({ key: s.key, label: s.label }))} />
            <Text style={styles.hint}>About {formatDistance(radiusM, units)} around you.</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>FOR</Text>
            <Segmented value={hours} onChange={setHours} items={HOURS.map((h) => ({ key: h.key, label: h.label }))} />
          </View>
          <View style={styles.note}>
            <Point icon="eye.slash.fill" text="No exact location, places, trips or drives while it's on, and that time stays out of your history for them." />
            <Point icon="battery.75percent" text="They still see your battery and when your phone last checked in." />
            <Point icon="figure.walk.departure" text="Leaving the area ends the bubble, so pick a size that covers where you'll be." />
          </View>
          {covered.length > 0 && exempt.length > 0 && (
            <Text style={styles.hint}>
              Hides you from {covered.map((c) => c.name).join(', ')}. {exempt.map((c) => c.name).join(', ')} {exempt.length === 1 ? 'has' : 'have'} bubbles turned off and will still see your exact location.
            </Text>
          )}
          {circles.length > 0 && covered.length === 0 && <Text style={[styles.hint, { color: C.red }]}>Bubbles are turned off in all of your circles.</Text>}
          <FormError error={error} />
          <PrimaryButton title={bubble ? 'Update bubble' : 'Start bubble'} icon="circle.dashed" onPress={() => void start()} loading={busy} disabled={circles.length > 0 && covered.length === 0} />
          {bubble && <PrimaryButton title="Keep current bubble" tone="plain" onPress={() => setEditing(false)} />}
        </Animated.View>
      ) : (
        bubble && (
          <Animated.View key="on" entering={appear} style={{ gap: 14 }}>
            <View style={styles.note}>
              <Point icon="mappin.and.ellipse" text={`Your circles see: ${bubbleArea(bubble, units)}.`} />
              <Point icon="clock" text={`Started ${clock(bubble.startedAt)}, ends ${clock(bubble.endsAt)}.`} />
              {exempt.length > 0 && <Point icon="exclamationmark.circle" text={`${exempt.map((c) => c.name).join(', ')} still see${exempt.length === 1 ? 's' : ''} your exact location (bubbles are off there).`} />}
            </View>
            <FormError error={error} />
            <PrimaryButton title="Change size or time" icon="slider.horizontal.3" tone="plain" onPress={() => setEditing(true)} />
            <PrimaryButton title="End bubble now" icon="xmark.circle.fill" onPress={() => void end()} loading={busy} />
          </Animated.View>
        )
      )}
    </ScrollView>
  );
}

function Point({ icon, text }: { icon: Parameters<typeof SymbolView>[0]['name']; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <SymbolView name={icon} size={17} tintColor={BUBBLE_COLOR} style={{ width: 22, marginTop: 1 }} />
      <Text style={[T.subhead, { color: C.label, flex: 1, lineHeight: 20 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: `${BUBBLE_COLOR}22`, alignItems: 'center', justifyContent: 'center' },
  map: { height: 170, borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: C.fill },
  label: { fontSize: 13, color: C.secondaryLabel, marginLeft: 4 },
  hint: { fontSize: 13, color: C.secondaryLabel, lineHeight: 18, marginHorizontal: 4 },
  note: { gap: 12, padding: 16, borderRadius: 22, borderCurve: 'continuous', backgroundColor: C.cell },
});
