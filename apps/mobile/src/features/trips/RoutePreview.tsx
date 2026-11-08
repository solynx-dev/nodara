import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { BRAND, C, HEX } from '@/lib/theme';
import { useNearScreen } from '@/lib/viewport';

/**
 * A small, still map of a trip's route for cards: start (green), the route in
 * brand purple, and the finish flag (or a pulsing dot while it's happening).
 *
 * Each preview is a real Apple map, so it's only mounted while the card is on
 * screen or close to it; further away it's a plain placeholder.
 */
export function RoutePreview({ points, live, height = 150 }: { points: [number, number][]; live?: boolean; height?: number }) {
  const { ref, near, onLayout } = useNearScreen();
  const coords = useMemo(() => points.map(([latitude, longitude]) => ({ latitude, longitude })), [points]);
  const region = useMemo(() => regionFor(points), [points]);
  const first = coords[0];
  const last = coords[coords.length - 1];

  return (
    <View ref={ref} onLayout={onLayout} style={[styles.box, { height }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {near && region && (
        <Animated.View entering={FadeIn.duration(250)} style={StyleSheet.absoluteFill}>
          <MapView
            provider={PROVIDER_DEFAULT}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            showsCompass={false}
            showsScale={false}
            showsBuildings={false}
            showsTraffic={false}
            showsIndoors={false}
            showsPointsOfInterests={false}
            moveOnMarkerPress={false}
          >
            {coords.length > 1 && <Polyline coordinates={coords} strokeColor="rgba(255,255,255,0.9)" strokeWidth={7} lineCap="round" lineJoin="round" />}
            {coords.length > 1 && <Polyline coordinates={coords} strokeColor={BRAND.purple} strokeWidth={4} lineCap="round" lineJoin="round" />}
            {first && (
              <Marker coordinate={first} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={[styles.dot, { backgroundColor: HEX.green }]} />
              </Marker>
            )}
            {last && coords.length > 1 && (
              <Marker coordinate={last} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                {live ? (
                  <View style={[styles.dot, { backgroundColor: BRAND.purple, width: 16, height: 16, borderRadius: 8 }]} />
                ) : (
                  <View style={styles.flag}>
                    <SymbolView name="flag.checkered" size={12} tintColor="white" />
                  </View>
                )}
              </Marker>
            )}
          </MapView>
        </Animated.View>
      )}
    </View>
  );
}

/** A region that fits the route with some room around it. */
function regionFor(points: [number, number][]) {
  if (!points.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  // Extra room at the top for the mode badge drawn over the map.
  const latSpan = Math.max(0.004, (maxLat - minLat) * 1.6);
  const lonSpan = Math.max(0.004, (maxLon - minLon) * 1.4);
  return { latitude: (minLat + maxLat) / 2 + latSpan * 0.06, longitude: (minLon + maxLon) / 2, latitudeDelta: latSpan, longitudeDelta: lonSpan };
}

const styles = StyleSheet.create({
  box: { backgroundColor: C.fill, overflow: 'hidden' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: 'white' },
  flag: { width: 26, height: 26, borderRadius: 13, backgroundColor: BRAND.purple, borderWidth: 2.5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
});
