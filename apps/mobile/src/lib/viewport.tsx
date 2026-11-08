import { createContext, use, useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, type ViewInstance } from 'react-native';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** The scroll offset of the list something sits in (the map sheet provides it). */
export const ScrollOffsetContext = createContext<SharedValue<number> | null>(null);

/**
 * Whether a view is on screen or close to it (within a screen above and two
 * below). Used to mount heavy things like map previews only when they're about
 * to be seen, and to let them go again once scrolled far away.
 */
export function useNearScreen() {
  const ref = useRef<ViewInstance>(null);
  const scrollY = use(ScrollOffsetContext);
  const { height } = useWindowDimensions();
  const [near, setNear] = useState(false);

  const check = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _w, h) => {
      if (!h) return;
      setNear(y + h > -height && y < height * 2);
    });
  }, [height]);

  useEffect(() => {
    const t = setTimeout(check, 50);
    return () => clearTimeout(t);
  }, [check]);

  // Re-check every ~quarter screen of scrolling.
  const step = Math.max(80, Math.round(height / 4));
  useAnimatedReaction(
    () => (scrollY ? Math.round(scrollY.get() / step) : 0),
    (cur, prev) => {
      if (prev !== null && cur !== prev) scheduleOnRN(check);
    },
  );

  return { ref, near, onLayout: check };
}
