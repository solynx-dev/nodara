import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type MapView from 'react-native-maps';
import type { MapType, Region } from 'react-native-maps';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import type { PresentationDetent } from '@expo/ui/swift-ui/modifiers';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useCircles, useLatestPlaceEvents, useLive, usePlaces } from '@/lib/queries';
import { C } from '@/lib/theme';
import type { PlaceWithMeta } from '@/lib/types';
import { ensureDevice, syncGeofences } from '@/background/tracking';
import { toFixes } from '@/background/upload';
import { GlassCircleButton, GlassMenu, GlassPillButton } from '@/components/glass';
import { NodaraMap } from '@/features/home/MapLayer';
import { detentHeight, HALF, HomeSheet, PEEK } from '@/features/home/HomeSheet';
import { PeoplePanel, PlacesPanel, SegmentChips, TripsPanel, type Segment } from '@/features/home/panels';
import { PersonPanel } from '@/features/home/PersonPanel';

const CIRCLE_KEY = 'nodara.circle';

/**
 * Home: one map-first screen. Floating Liquid Glass controls on top, a
 * persistent native sheet with People / Places / Trips at the bottom, and
 * person details opening inside that sheet while the map follows them.
 */
export default function Home() {
  const me = useMe();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const map = useRef<MapView>(null);

  const [storedCircleId, setCircleIdState] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('people');
  const [pickedId, setSelectedId] = useState<string | null>(null);
  const [detent, setDetent] = useState<PresentationDetent>(HALF);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [region, setRegion] = useState<Region | null>(null);

  const { data: circles = [] } = useCircles();
  // Fall back to "All circles" if the saved circle was left or deleted.
  const circleId = storedCircleId && (circles.length === 0 || circles.some((c) => c.id === storedCircleId)) ? storedCircleId : null;
  // Deep links / notification taps: /?member=<id> opens that person.
  const params = useLocalSearchParams<{ member?: string }>();
  const selectedId = pickedId ?? params.member ?? null;
  const { data: members = [] } = useLive(circleId);
  const { data: allPlaces = [] } = usePlaces();
  const events = useLatestPlaceEvents();
  const { data: unread } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/api/notifications?limit=1'), refetchInterval: 120_000 });
  const circle = circles.find((c) => c.id === circleId) ?? null;
  const places = useMemo(() => (circleId ? allPlaces.filter((p) => p.circleId === circleId || p.circleId === null) : allPlaces), [allPlaces, circleId]);
  const selected = members.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    void AsyncStorage.getItem(CIRCLE_KEY).then((v) => v && setCircleIdState(v));
  }, []);
  const clearSelection = () => {
    setSelectedId(null);
    if (params.member) router.setParams({ member: undefined });
  };
  const setCircleId = (id: string | null) => {
    setCircleIdState(id);
    clearSelection();
    fitted.current = false;
    void (id ? AsyncStorage.setItem(CIRCLE_KEY, id) : AsyncStorage.removeItem(CIRCLE_KEY));
  };

  // The sheet is a native presentation: hide it before leaving this screen, show it again on return.
  useFocusEffect(
    useCallback(() => {
      setSheetVisible(true);
    }, []),
  );
  const go = (href: Href) => {
    setSheetVisible(false);
    setTimeout(() => router.push(href), 380);
  };

  // Keep iOS region monitoring in sync with the family's places.
  useEffect(() => {
    if (!allPlaces.length) return;
    const mine = members.find((m) => m.id === me.id)?.location;
    void syncGeofences(allPlaces, mine ? { lat: mine.lat, lon: mine.lon } : null);
  }, [allPlaces, members, me.id]);

  const sheetH = detentHeight(detent, screenH);
  const located = useMemo(() => members.filter((m) => m.location), [members]);

  const fitAll = useCallback(() => {
    if (!located.length) return;
    map.current?.fitToCoordinates(
      located.map((m) => ({ latitude: m.location!.lat, longitude: m.location!.lon })),
      { edgePadding: { top: insets.top + 120, right: 70, bottom: 70, left: 70 }, animated: true },
    );
  }, [located, insets.top]);
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && located.length) {
      fitted.current = true;
      setTimeout(fitAll, 400);
    }
  }, [located.length, fitAll]);

  // Follow the selected person as their location updates.
  const selLoc = selected?.location;
  useEffect(() => {
    if (selLoc) map.current?.animateCamera({ center: { latitude: selLoc.lat, longitude: selLoc.lon } }, { duration: 600 });
  }, [selLoc?.lat, selLoc?.lon, selLoc]);

  const selectPerson = (id: string) => {
    void Haptics.selectionAsync();
    setSelectedId(id);
    setSegment('people');
    if (detent === 'large') setDetent(HALF);
    const loc = members.find((m) => m.id === id)?.location;
    if (loc) map.current?.animateCamera({ center: { latitude: loc.lat, longitude: loc.lon }, zoom: 16 }, { duration: 700 });
  };

  const focusPlace = (p: PlaceWithMeta) => {
    map.current?.animateCamera({ center: { latitude: p.lat, longitude: p.lon }, zoom: 16 }, { duration: 700 });
    setDetent(PEEK);
  };

  const locateMe = async () => {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return go('/share-location');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    map.current?.animateCamera({ center: { latitude: p.coords.latitude, longitude: p.coords.longitude }, zoom: 15 }, { duration: 600 });
  };

  const addPlace = (lat: number, lon: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.prompt('New place', 'Name it to get arrival and departure alerts — like Home, School or Work.', async (name) => {
      if (!name?.trim()) return;
      try {
        await api.post('/api/places', { name: name.trim(), lat, lon, radiusM: 150, icon: /home/i.test(name) ? 'home' : /work|office/i.test(name) ? 'work' : /school/i.test(name) ? 'school' : 'pin', color: '#FF6B3D', circleId: circleId ?? circles[0]?.id ?? null });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        qc.invalidateQueries({ queryKey: ['places'] });
      } catch (e) {
        Alert.alert('Could not save place', (e as Error).message);
      }
    });
  };
  const addPlaceAtCenter = () => {
    const c = region ?? { latitude: 45.42, longitude: -75.69 };
    addPlace(c.latitude, c.longitude);
  };

  const invite = () => {
    const doInvite = async (id: string, name: string) => {
      try {
        const r = await api.post<{ url: string }>(`/api/circles/${id}/invitations`, { expiresInHours: 72, maxUses: 1 });
        await Share.share({ message: `Join "${name}" on Nodara so we can see where each other are: ${r.url}`, url: r.url });
      } catch (e) {
        Alert.alert('Could not create invitation', (e as Error).message);
      }
    };
    if (circle) return void doInvite(circle.id, circle.name);
    if (circles.length === 1) return void doInvite(circles[0]!.id, circles[0]!.name);
    if (circles.length === 0) return newCircle();
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Invite to which circle?', options: [...circles.map((c) => c.name), 'Cancel'], cancelButtonIndex: circles.length }, (i) => {
      const c = circles[i];
      if (c) void doInvite(c.id, c.name);
    });
  };

  const newCircle = () =>
    Alert.prompt('New circle', 'Family, roommates, a road trip…', async (name) => {
      if (!name?.trim()) return;
      try {
        const c = await api.post<{ id: string }>('/api/circles', { name: name.trim() });
        qc.invalidateQueries({ queryKey: ['circles'] });
        setCircleId(c.id);
      } catch (e) {
        Alert.alert('Could not create circle', (e as Error).message);
      }
    });

  const checkIn = () => {
    Alert.prompt(
      'Check in',
      `Let ${circle ? circle.name : 'your circles'} know where you are right now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check in',
          onPress: async (message?: string) => {
            try {
              const perm = await Location.getForegroundPermissionsAsync();
              if (perm.status !== 'granted') return go('/share-location');
              const deviceId = await ensureDevice();
              const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
              const [fix] = await toFixes([pos]);
              const r = await api.post<{ notified: number; where: string | null }>('/api/checkins', { deviceId, circleId, message: message?.trim() || null, location: fix });
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Checked in', `${r.where ? `At ${r.where}. ` : ''}${r.notified} ${r.notified === 1 ? 'person was' : 'people were'} notified.`);
              qc.invalidateQueries({ queryKey: ['live'] });
            } catch (e) {
              Alert.alert('Could not check in', (e as Error).message);
            }
          },
        },
      ],
      'plain-text',
      '',
      'default',
    );
  };

  const live = located.length;
  return (
    <View style={{ flex: 1 }}>
      <NodaraMap
        ref={map}
        members={members}
        places={places}
        events={events}
        meId={me.id}
        selectedId={selectedId}
        mapType={mapType}
        region={region}
        bottomInset={detent === 'large' ? 0 : sheetH - insets.bottom}
        onRegion={setRegion}
        onSelect={selectPerson}
        onLongPress={addPlace}
      />

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
        <GlassCircleButton icon="gearshape.fill" label="Settings" onPress={() => go('/settings')} />
        <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="box-none">
          <GlassMenu
            label={circle?.name ?? 'All circles'}
            icon="person.2.fill"
            options={[
              { key: 'all', label: 'All circles', checked: !circleId, onPress: () => setCircleId(null) },
              ...circles.map((c) => ({ key: c.id, label: c.name, checked: c.id === circleId, onPress: () => setCircleId(c.id) })),
              { key: 'new', label: 'New circle…', icon: 'plus' as const, dividerBefore: true, onPress: newCircle },
              { key: 'invite', label: 'Invite someone…', icon: 'person.badge.plus' as const, onPress: invite },
            ]}
          />
        </View>
        <GlassCircleButton icon="bell.fill" label="Alerts" badge={unread?.unread} onPress={() => go('/alerts')} />
      </View>

      {/* Floating controls above the sheet */}
      {detent !== 'large' && (
        <View style={[styles.floatRow, { bottom: sheetH + 12 }]} pointerEvents="box-none">
          <GlassPillButton icon="mappin.and.ellipse" label="Check in" onPress={checkIn} />
          <View style={{ flex: 1 }} />
          <View style={{ gap: 10 }}>
            <GlassMenu
              iconOnly
              label="Map style"
              icon="square.3.layers.3d"
              options={(
                [
                  ['standard', 'Standard'],
                  ['mutedStandard', 'Muted'],
                  ['satellite', 'Satellite'],
                  ['hybrid', 'Hybrid'],
                ] as [MapType, string][]
              ).map(([t, l]) => ({ key: t, label: l, checked: mapType === t, onPress: () => setMapType(t) }))}
            />
            <GlassCircleButton icon={selectedId ? 'person.2.fill' : 'location.fill'} label={selectedId ? 'Show everyone' : 'My location'} onPress={selectedId ? () => (clearSelection(), fitAll()) : locateMe} />
          </View>
        </View>
      )}

      <HomeSheet visible={sheetVisible} detent={detent} onDetentChange={setDetent}>
        <ScrollView contentContainerStyle={{ paddingTop: 22, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {selected ? (
            <PersonPanel m={selected} ev={events.get(selected.id)} onBack={clearSelection} onOpenTrip={(id) => go(`/trip/${id}`)} />
          ) : (
            <>
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>{circle?.name ?? 'Everyone'}</Text>
                  <Text style={styles.sheetSub}>
                    {members.length} {members.length === 1 ? 'person' : 'people'} · {live} on the map
                  </Text>
                </View>
                <Pressable onPress={invite} accessibilityLabel="Invite someone" hitSlop={10} style={styles.headerButton}>
                  <SymbolView name="person.badge.plus" size={20} tintColor={C.accent} />
                </Pressable>
              </View>
              <SegmentChips value={segment} onChange={setSegment} />
              {segment === 'people' && <PeoplePanel members={members} events={events} onSelect={selectPerson} onInvite={invite} />}
              {segment === 'places' && <PlacesPanel places={places} members={members} onFocus={focusPlace} onAdd={addPlaceAtCenter} />}
              {segment === 'trips' && <TripsPanel members={members} onOpen={(id) => go(`/trip/${id}`)} />}
            </>
          )}
        </ScrollView>
      </HomeSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  floatRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-end' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 },
  sheetTitle: { fontSize: 28, fontWeight: '800', color: C.label, letterSpacing: -0.4 },
  sheetSub: { fontSize: 14, color: C.secondaryLabel, marginTop: 2 },
  headerButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
