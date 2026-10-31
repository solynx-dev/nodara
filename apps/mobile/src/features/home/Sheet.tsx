import { useEffect, useMemo, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { interpolate, Extrapolation, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { GestureDetector, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/theme';
import { Glass } from '@/components/ui';

export type SheetIndex = 0 | 1 | 2; // peek, half, full

const SPRING = { damping: 26, stiffness: 260, mass: 0.9, overshootClamping: false } as const;

/** Y positions (distance from the top of the screen to the sheet's top edge) for each detent. */
export function useSheetPositions() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const peek = height - (insets.bottom + 210);
    const half = Math.round(height * 0.47);
    const full = insets.top + 64;
    return { positions: [peek, half, full] as const, height };
  }, [height, insets.bottom, insets.top]);
}

function haptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}

/**
 * Map bottom sheet in the style of Find My / Life360. Drag the header (or tap
 * the grabber) to move between detents; the body scrolls independently.
 * Liquid Glass at partial heights, fading to an opaque background when
 * expanded so long lists stay readable.
 */
export function MapSheet({
  y,
  index,
  onIndexChange,
  header,
  children,
  refreshing,
  onRefresh,
}: {
  y: SharedValue<number>;
  index: SheetIndex;
  onIndexChange: (i: SheetIndex) => void;
  header: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { positions, height } = useSheetPositions();
  const [peek, half, full] = positions;
  const start = useSharedValue(0);

  // Follow index changes made from outside (selecting a person, etc.).
  useEffect(() => {
    const target = positions[index];
    if (Math.abs(y.value - target) > 1) y.set(withSpring(target, SPRING));
  }, [index, positions, y]);

  const settle = (i: SheetIndex) => {
    haptic();
    onIndexChange(i);
  };

  const pan = usePanGesture({
    activeOffsetY: [-6, 6],
    onBegin: () => {
      'worklet';
      start.set(y.value);
    },
    onUpdate: (e) => {
      'worklet';
      let next = start.value + e.translationY;
      // Rubber-band beyond the top and bottom detents.
      if (next < full) next = full - (full - next) * 0.25;
      if (next > peek) next = peek + (next - peek) * 0.25;
      y.set(next);
    },
    onDeactivate: (e) => {
      'worklet';
      const projected = y.value + e.velocityY * 0.18;
      const pts = [peek, half, full];
      let best = 0;
      for (let i = 1; i < 3; i++) if (Math.abs(pts[i]! - projected) < Math.abs(pts[best]! - projected)) best = i;
      y.set(withSpring(pts[best]!, { ...SPRING, velocity: e.velocityY }));
      scheduleOnRN(settle, best as SheetIndex);
    },
  });

  const tap = useTapGesture({
    onDeactivate: (e) => {
      'worklet';
      if (e.canceled) return;
      const next: SheetIndex = index === 2 ? 1 : ((index + 1) as SheetIndex);
      y.set(withSpring([peek, half, full][next]!, SPRING));
      scheduleOnRN(settle, next);
    },
  });

  const container = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    height: Math.max(0, height - y.value),
  }));
  // Opaque backdrop fades in between half and full height.
  const solid = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [half, full], [0, 1], Extrapolation.CLAMP) }));
  const corner = useAnimatedStyle(() => ({ borderTopLeftRadius: interpolate(y.value, [half, full], [34, 28], Extrapolation.CLAMP), borderTopRightRadius: interpolate(y.value, [half, full], [34, 28], Extrapolation.CLAMP) }));

  return (
    <Animated.View style={[styles.sheet, container]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.clip, corner]}>
        <Glass style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.groupedBackground }, solid]} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <View>
          <GestureDetector gesture={tap}>
            <View style={styles.grabberArea} accessibilityRole="adjustable" accessibilityLabel="Resize panel" accessibilityHint="Tap to expand or collapse">
              <View style={styles.grabber} />
            </View>
          </GestureDetector>
          {header}
        </View>
      </GestureDetector>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
  },
  clip: { overflow: 'hidden' },
  grabberArea: { height: 26, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.fillStrong },
});
