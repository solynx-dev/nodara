import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { positionAt, type PathPoint } from '@/lib/livePath';
import { clock, formatSpeed, type Units } from '@/lib/format';
import { C, T } from '@/lib/theme';
import type { TripDetail } from '@/lib/types';
import { Glass, Tap } from '@/components/ui';
import { Slider } from '@/components/Slider';

const FRAME_MS = 50;
const BASE_SECONDS = 20; // a whole drive replays in about 20 s at 1×

/**
 * Replay of a drive on its map: the pin follows the real route at the real
 * relative pace (fast through the highway, slow in traffic), compressed so the
 * whole trip plays in ~20 s. Starts by itself shortly after the screen opens.
 */
export function useReplay(samples: TripDetail['samples'], autoPlay: boolean) {
  const points = useMemo<PathPoint[]>(
    () =>
      samples
        .filter((s) => s.lat != null && s.lon != null)
        .map((s) => ({ t: Date.parse(s.t), lat: s.lat!, lon: s.lon!, speed: s.speed, heading: null })),
    [samples],
  );
  const start = points[0]?.t ?? 0;
  const span = Math.max(1, (points[points.length - 1]?.t ?? 0) - start);
  const usable = points.length > 1;
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const pRef = useRef(0);

  // Start on its own once the map has settled on the route.
  useEffect(() => {
    if (!autoPlay || !usable) return;
    const id = setTimeout(() => setPlaying(true), 900);
    return () => clearTimeout(id);
  }, [autoPlay, usable]);

  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      pRef.current = Math.min(1, pRef.current + ((now - last) * rate) / (BASE_SECONDS * 1000));
      last = now;
      setProgress(pRef.current);
      if (pRef.current >= 1) {
        clearInterval(id);
        setPlaying(false);
      }
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [playing, rate]);

  const t = start + progress * span;
  const position = usable ? positionAt(points, t, 0) : null;
  const active = playing || (progress > 0 && progress < 1);
  const travelled = useMemo(() => {
    if (!active || !position) return null;
    const done = points.filter((p) => p.t <= t).map((p) => ({ latitude: p.lat, longitude: p.lon }));
    return [...done, { latitude: position.lat, longitude: position.lon }];
  }, [active, points, t, position]);

  return {
    usable,
    playing,
    active,
    progress,
    rate,
    time: new Date(t).toISOString(),
    position,
    travelled,
    toggle: () => {
      if (pRef.current >= 1) {
        pRef.current = 0;
        setProgress(0);
      }
      setPlaying((v) => !v);
    },
    seek: (f: number) => {
      pRef.current = f;
      setProgress(f);
    },
    cycleRate: () => setRate((r) => (r >= 4 ? 1 : r * 2)),
  };
}

export type Replay = ReturnType<typeof useReplay>;

/** Glass control bar laid over the bottom of the trip map. */
export function ReplayBar({ replay, units, color }: { replay: Replay; units: Units; color: string }) {
  if (!replay.usable) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Glass style={styles.bar}>
        <Tap onPress={replay.toggle} style={styles.play} accessibilityRole="button" accessibilityLabel={replay.playing ? 'Pause replay' : 'Play replay'}>
          <SymbolView name={replay.playing ? 'pause.fill' : replay.progress >= 1 ? 'arrow.counterclockwise' : 'play.fill'} size={16} tintColor="white" />
        </Tap>
        <View style={{ flex: 1 }}>
          <Slider
            value={replay.progress}
            onChange={replay.seek}
            color={color}
            accessibilityLabel="Replay position"
            accessibilityValue={clock(replay.time)}
            onAccessibilityStep={(d) => replay.seek(Math.min(1, Math.max(0, replay.progress + d * 0.05)))}
          />
        </View>
        <View style={{ alignItems: 'flex-end', minWidth: 74 }}>
          <Text style={[T.footnote, styles.num]}>{clock(replay.time)}</Text>
          <Text style={[T.caption, styles.num, { color: C.secondaryLabel }]}>{replay.position?.speed != null ? formatSpeed(replay.position.speed, units) : '—'}</Text>
        </View>
        <Tap onPress={replay.cycleRate} style={styles.rate} accessibilityRole="button" accessibilityLabel={`Replay speed ${replay.rate} times`}>
          <Text style={[T.caption, { color: C.label, fontWeight: '700' }]}>{replay.rate}×</Text>
        </Tap>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 6, paddingRight: 8, height: 54, borderRadius: 27 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  rate: { paddingHorizontal: 9, height: 28, borderRadius: 14, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
  num: { color: C.label, fontVariant: ['tabular-nums'], fontWeight: '600' },
});
