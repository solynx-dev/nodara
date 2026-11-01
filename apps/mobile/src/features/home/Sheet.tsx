import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { GestureDetector, useNativeGesture, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/theme';
import { Glass } from '@/components/ui';

export type SheetIndex = 0 | 1 | 2; // peek, half, full

const SPRING = { damping: 28, stiffness: 280, mass: 0.9 } as const;

/** Y positions (distance from the top of the screen to the sheet's top edge) for each detent. */
export function useSheetPositions() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const peek = height - (insets.bottom + 196);
    const half = Math.round(height * 0.5);
    const full = insets.top + 62;
    return { positions: [peek, half, full] as const, height };
  }, [height, insets.bottom, insets.top]);
}

/**
 * Map bottom sheet in the style of Apple Maps / Find My.
 *
 * - Drag the header, or the list itself, to resize it. Below full height the
 *   list doesn't scroll: dragging it moves the sheet. At full height the list
 *   scrolls, and pulling down from the top of the list brings the sheet down.
 * - The sheet is a fixed height and only slides (no per-frame layout), so it
 *   stays smooth.
 * - `accessory` (the floating map buttons) is part of the sheet, sitting just
 *   above its top edge, so it can never end up behind it.
 */
export function MapSheet({
  y,
  index,
  onIndexChange,
  header,
  accessory,
  children,
  resetKey,
}: {
  y: SharedValue<number>;
  index: SheetIndex;
  onIndexChange: (i: SheetIndex) => void;
  header: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  /** Scroll back to the top whenever this changes (new person, new tab…). */
  resetKey?: string;
}) {
  const { positions, height } = useSheetPositions();
  const insets = useSafeAreaInsets();
  const [peek, half, full] = positions;
  const start = useSharedValue(0);
  const driving = useSharedValue(false);
  const scrollY = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  // Follow index changes made from outside (selecting a person, etc.).
  useEffect(() => {
    const target = positions[index];
    if (Math.abs(y.get() - target) > 1) y.set(withSpring(target, SPRING));
  }, [index, positions, y]);

  // Below full height the list is "parked" at the top.
  useEffect(() => {
    if (index !== 2) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [index, scrollRef]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [resetKey, scrollRef]);

  const settle = (i: SheetIndex) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    onIndexChange(i);
  };

  const follow = (translationY: number) => {
    'worklet';
    let next = start.get() + translationY;
    // Rubber-band beyond the top and bottom detents.
    if (next < full) next = full - (full - next) * 0.2;
    if (next > peek) next = peek + (next - peek) * 0.25;
    y.set(next);
  };

  const snap = (velocityY: number) => {
    'worklet';
    const projected = y.get() + velocityY * 0.2;
    const pts = [peek, half, full];
    let best = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(pts[i]! - projected) < Math.abs(pts[best]! - projected)) best = i;
    y.set(withSpring(pts[best]!, { ...SPRING, velocity: velocityY }));
    scheduleOnRN(settle, best as SheetIndex);
  };

  // Header: always moves the sheet.
  const headerPan = usePanGesture({
    activeOffsetY: [-6, 6],
    onBegin: () => {
      'worklet';
      start.set(y.get());
    },
    onUpdate: (e) => {
      'worklet';
      follow(e.translationY);
    },
    onDeactivate: (e) => {
      'worklet';
      snap(e.velocityY);
    },
  });

  // Body: moves the sheet unless it's fully open and the list should scroll.
  const native = useNativeGesture({});
  const bodyPan = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-16, 16],
    onBegin: () => {
      'worklet';
      driving.set(false);
    },
    onUpdate: (e) => {
      'worklet';
      if (!driving.get()) {
        const expanded = y.get() <= full + 1;
        const pullingDownAtTop = scrollY.get() <= 1 && e.changeY > 0;
        if (expanded && !pullingDownAtTop) return; // let the list scroll
        driving.set(true);
        start.set(y.get() - e.translationY);
      }
      follow(e.translationY);
    },
    onDeactivate: (e) => {
      'worklet';
      if (!driving.get()) return;
      driving.set(false);
      snap(e.velocityY);
    },
  });
  const body = useSimultaneousGestures(bodyPan, native);

  const tap = useTapGesture({
    onDeactivate: (e) => {
      'worklet';
      if (e.canceled) return;
      const next: SheetIndex = index === 2 ? 1 : ((index + 1) as SheetIndex);
      y.set(withSpring([peek, half, full][next]!, SPRING));
      scheduleOnRN(settle, next);
    },
  });

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });

  const container = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  // Opaque backdrop fades in between half and full height so long lists stay readable.
  const solid = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [half, full], [0, 1], Extrapolation.CLAMP) }));
  // Floating buttons fade and shrink away as the sheet takes over the screen.
  const accessoryStyle = useAnimatedStyle(() => {
    const v = interpolate(y.get(), [full + 90, half - 10], [0, 1], Extrapolation.CLAMP);
    return { opacity: v, transform: [{ scale: 0.92 + 0.08 * v }] };
  });

  return (
    <Animated.View style={[styles.sheet, { height: height - full }, container]}>
      {accessory && (
        <Animated.View style={[styles.accessory, accessoryStyle]} pointerEvents="box-none">
          {accessory}
        </Animated.View>
      )}
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <Glass style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.groupedBackground }, solid]} />
      </View>
      <GestureDetector gesture={headerPan}>
        <View>
          <GestureDetector gesture={tap}>
            <View style={styles.grabberArea} accessibilityRole="adjustable" accessibilityLabel="Resize panel" accessibilityHint="Tap to expand or collapse">
              <View style={styles.grabber} />
            </View>
          </GestureDetector>
          {header}
        </View>
      </GestureDetector>
      <GestureDetector gesture={body}>
        <Animated.ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
          scrollEnabled={index === 2}
          bounces={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={index === 2}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </Animated.ScrollView>
      </GestureDetector>
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
  accessory: { position: 'absolute', left: 16, right: 16, bottom: '100%', marginBottom: 12 },
  clip: { overflow: 'hidden', borderTopLeftRadius: 32, borderTopRightRadius: 32, borderCurve: 'continuous' },
  grabberArea: { height: 26, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.fillStrong },
});
