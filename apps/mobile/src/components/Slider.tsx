import { useEffect } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/theme';

const THUMB = 28;

/**
 * Horizontal slider for a 0–1 value. Drag the thumb, or tap anywhere on the
 * track to jump there. Built on gesture-handler so it needs no extra native
 * module, and it lets vertical scrolling through.
 */
export function Slider({
  value,
  onChange,
  onCommit,
  color = C.accent,
  accessibilityLabel,
  accessibilityValue,
  onAccessibilityStep,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  color?: ColorValue;
  accessibilityLabel: string;
  accessibilityValue: string;
  /** VoiceOver swipe up / down. */
  onAccessibilityStep: (direction: 1 | -1) => void;
}) {
  const pos = useSharedValue(value);
  const width = useSharedValue(0);
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (!dragging.get()) pos.set(value);
  }, [value, pos, dragging]);

  const commit = (v: number) => {
    void Haptics.selectionAsync();
    onCommit?.(v);
  };

  const at = (x: number) => {
    'worklet';
    const w = width.get() - THUMB;
    return w > 0 ? Math.min(1, Math.max(0, (x - THUMB / 2) / w)) : 0;
  };

  const pan = usePanGesture({
    activeOffsetX: [-3, 3],
    failOffsetY: [-12, 12],
    onActivate: (e) => {
      'worklet';
      dragging.set(true);
      pos.set(at(e.x));
      scheduleOnRN(onChange, pos.get());
    },
    onUpdate: (e) => {
      'worklet';
      pos.set(at(e.x));
      scheduleOnRN(onChange, pos.get());
    },
    onDeactivate: () => {
      'worklet';
      dragging.set(false);
      scheduleOnRN(commit, pos.get());
    },
  });
  const tap = useTapGesture({
    onDeactivate: (e) => {
      'worklet';
      if (e.canceled) return;
      pos.set(at(e.x));
      scheduleOnRN(onChange, pos.get());
      scheduleOnRN(commit, pos.get());
    },
  });
  const gesture = useCompetingGestures(pan, tap);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: pos.get() * Math.max(0, width.get() - THUMB) }] }));
  const fill = useAnimatedStyle(() => ({ width: 3 + pos.get() * Math.max(0, width.get() - THUMB) }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.hit}
        onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: accessibilityValue }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onAccessibilityStep(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { backgroundColor: color }, fill]} />
        </View>
        <Animated.View style={[styles.thumb, thumb]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: C.fillStrong, marginHorizontal: THUMB / 2 - 3, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
