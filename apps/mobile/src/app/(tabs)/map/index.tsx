import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle as MapCircle, Marker, type MapType } from 'react-native-maps';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/lib/session';
import { useCircles, useLive, usePlaces } from '@/lib/queries';
import { api } from '@/lib/api';
import { firstName, freshness } from '@/lib/format';
import { C } from '@/lib/theme';
import { syncGeofences } from '@/background/tracking';
import { MemberMarker } from '@/components/MemberMarker';
import { Avatar, Glass, GlassIconButton } from '@/components/ui';

export default function MapScreen() {
  const me = useMe();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const map = useRef<MapView>(null);
  const { data: members = [] } = useLive();
  const { data: places = [] } = usePlaces();
  const { data: circles = [] } = useCircles();
  const [mapType, setMapType] = useState<MapType>('mutedStandard');
  const located = useMemo(() => members.filter((m) => m.location), [members]);

  // Keep native region monitoring in sync with the family's places.
  useEffect(() => {
    if (!places.length) return;
    const mine = located.find((m) => m.id === me.id)?.location;
    void syncGeofences(places, mine ? { lat: mine.lat, lon: mine.lon } : null);
  }, [places, located, me.id]);

  const fitAll = () => {
    if (!located.length) return;
    map.current?.fitToCoordinates(
      located.map((m) => ({ latitude: m.location!.lat, longitude: m.location!.lon })),
      { edgePadding: { top: 140, right: 80, bottom: 260, left: 80 }, animated: true },
    );
  };
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && located.length) {
      fitted.current = true;
      setTimeout(fitAll, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.length]);

  const locateMe = async () => {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return router.push('/share-location');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    map.current?.animateCamera({ center: { latitude: p.coords.latitude, longitude: p.coords.longitude }, zoom: 15 }, { duration: 600 });
  };

  const chooseMapType = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Map style', options: ['Standard', 'Muted', 'Satellite', 'Hybrid', 'Cancel'], cancelButtonIndex: 4 },
      (i) => {
        const types: MapType[] = ['standard', 'mutedStandard', 'satellite', 'hybrid'];
        if (types[i]) setMapType(types[i]!);
      },
    );

  // Long-press anywhere to save a place (geofence) there.
  const addPlace = (lat: number, lon: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.prompt('New place', 'Name this place to get arrival and departure alerts.', async (name) => {
      if (!name?.trim()) return;
      const pick = (circleId: string | null) =>
        api
          .post('/api/places', { name: name.trim(), lat, lon, radiusM: 150, icon: 'pin', color: '#FF6B3D', circleId })
          .then(() => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            qc.invalidateQueries({ queryKey: ['places'] });
          })
          .catch((e: Error) => Alert.alert('Could not save place', e.message));
      if (circles.length === 0) return pick(null);
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `Share "${name.trim()}" with`, options: [...circles.map((c) => c.name), 'Only me', 'Cancel'], cancelButtonIndex: circles.length + 1 },
        (i) => {
          if (i < circles.length) void pick(circles[i]!.id);
          else if (i === circles.length) void pick(null);
        },
      );
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        mapType={mapType}
        showsUserLocation
        showsCompass={false}
        showsPointsOfInterests
        pitchEnabled
        onLongPress={(e) => addPlace(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
        initialRegion={{ latitude: 45.42, longitude: -75.69, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
      >
        {places.map((p) => (
          <MapCircle key={p.id} center={{ latitude: p.lat, longitude: p.lon }} radius={p.radiusM} strokeColor={p.color} strokeWidth={1.5} fillColor={`${p.color}22`} />
        ))}
        {places.map((p) => (
          <Marker key={`label-${p.id}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.placeLabel}>
              <View style={[styles.placeDot, { backgroundColor: p.color }]} />
              <Text style={styles.placeText}>{p.name}</Text>
            </View>
          </Marker>
        ))}
        {located.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.location!.lat, longitude: m.location!.lon }}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => router.push(`/member/${m.id}`)}
            zIndex={m.id === me.id ? 1 : 2}
          >
            <MemberMarker member={m} isMe={m.id === me.id} />
          </Marker>
        ))}
      </MapView>

      {/* Floating controls */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-start' }}>
        <Glass style={styles.titlePill}>
          <View style={[styles.liveDot, { backgroundColor: located.length ? (C.green as string) : (C.tertiaryLabel as string) }]} />
          <Text style={styles.titleText}>
            {located.length} {located.length === 1 ? 'person' : 'people'} on the map
          </Text>
        </Glass>
        <View style={{ flex: 1 }} />
        <View style={{ gap: 10 }}>
          <GlassIconButton icon="person.2.fill" label="Show everyone" onPress={fitAll} />
          <GlassIconButton icon="location.fill" label="My location" onPress={locateMe} />
          <GlassIconButton icon="map" label="Map style" onPress={chooseMapType} />
        </View>
      </View>

      {/* People strip above the tab bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 62 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {members.map((m) => {
            const f = freshness(m.location?.recordedAt);
            return (
              <Pressable key={m.id} onPress={() => router.push(`/member/${m.id}`)}>
                <Glass interactive style={styles.chip}>
                  <Avatar name={m.displayName} color={m.avatarColor} size={34} dim={!m.location || f === 'old'} />
                  <View>
                    <Text style={styles.chipName}>{m.id === me.id ? 'You' : firstName(m.displayName)}</Text>
                    <Text style={styles.chipSub} numberOfLines={1}>
                      {!m.location ? (m.sharing ? 'No location yet' : 'Not sharing') : m.currentPlace ? m.currentPlace.name : f === 'live' ? 'Live' : f === 'recent' ? 'Recently' : 'Out of date'}
                    </Text>
                  </View>
                </Glass>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titlePill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  titleText: { fontSize: 15, fontWeight: '600', color: C.label },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 6, paddingRight: 16, height: 50, borderRadius: 25 },
  chipName: { fontSize: 15, fontWeight: '600', color: C.label },
  chipSub: { fontSize: 12, color: C.secondaryLabel, maxWidth: 120 },
  placeLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  placeDot: { width: 8, height: 8, borderRadius: 4 },
  placeText: { fontSize: 11, fontWeight: '700', color: '#111' },
});
