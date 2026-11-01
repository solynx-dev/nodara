import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Share, StyleSheet, Text, View } from 'react-native';
import type MapView from 'react-native-maps';
import type { MapType, Region } from 'react-native-maps';
import Animated, { FadeIn, useSharedValue } from 'react-native-reanimated';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { useCircles, useLive, usePlaceEvents, usePlaces } from '@/lib/queries';
import { circleSummary } from '@/lib/status';
import { C, T } from '@/lib/theme';
import type { PlaceWithMeta } from '@/lib/types';
import { getItem, KEYS } from '@/lib/storage';
import { getMapType, MAP_TYPES, setMapTypePref } from '@/lib/prefs';
import { ensureDevice, syncGeofences } from '@/background/tracking';
import { toFixes } from '@/background/upload';
import { GlassButton, GlassPill, Segmented, useToast } from '@/components/ui';
import { NodaraMap } from '@/features/home/MapLayer';
import { MapSheet, useSheetPositions, type SheetIndex } from '@/features/home/Sheet';
import { PeoplePanel, PlacesPanel, type Segment } from '@/features/home/panels';
import { ProfileBody, ProfileHeader } from '@/features/profile/Profile';
import { TopBar } from '@/features/home/TopBar';

const CIRCLE_KEY = 'nodara.circle';
const ONBOARDED_KEY = 'nodara.onboarded';

/**
 * Home: one map-first screen. Floating Liquid Glass controls on top, a
 * draggable sheet with People / Places at the bottom, and each person's
 * profile (status, drives, history) opening inside that sheet while the map
 * follows them.
 */
export default function Home() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const map = useRef<MapView>(null);
  const { positions, height } = useSheetPositions();
  const y = useSharedValue<number>(positions[1]);

  const [storedCircleId, setCircleIdState] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('people');
  const [pickedId, setSelectedId] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState<SheetIndex>(1);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [region, setRegion] = useState<Region | null>(null);

  const { data: circles = [] } = useCircles();
  const circleId = storedCircleId && (circles.length === 0 || circles.some((c) => c.id === storedCircleId)) ? storedCircleId : null;
  const params = useLocalSearchParams<{ member?: string }>();
  const selectedId = pickedId ?? params.member ?? null;
  const live = useLive(circleId);
  const members = useMemo(() => live.data ?? [], [live.data]);
  const { data: allPlaces = [] } = usePlaces();
  const events = usePlaceEvents();
  const { data: unread } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/api/notifications?limit=1'), refetchInterval: 60_000 });
  const circle = circles.find((c) => c.id === circleId) ?? null;
  const places = useMemo(() => (circleId ? allPlaces.filter((p) => p.circleId === circleId || p.circleId === null) : allPlaces), [allPlaces, circleId]);
  const selected = members.find((m) => m.id === selectedId) ?? null;
  const located = useMemo(() => members.filter((m) => m.location), [members]);

  useEffect(() => {
    void AsyncStorage.getItem(CIRCLE_KEY).then((v) => v && setCircleIdState(v));
  }, []);
  // The default map style can be changed in Settings.
  useFocusEffect(
    useCallback(() => {
      void getMapType().then((t) => t && setMapType(t));
    }, []),
  );

  // First run: explain and request location sharing once.
  useEffect(() => {
    void (async () => {
      if ((await AsyncStorage.getItem(ONBOARDED_KEY)) || (await getItem(KEYS.tracking))) return;
      await AsyncStorage.setItem(ONBOARDED_KEY, '1');
      setTimeout(() => router.push('/share-location'), 900);
    })();
  }, []);

  // Keep iOS region monitoring in sync with the family's places.
  useEffect(() => {
    if (!allPlaces.length) return;
    const mine = members.find((m) => m.id === me.id)?.location;
    void syncGeofences(allPlaces, mine ? { lat: mine.lat, lon: mine.lon } : null);
  }, [allPlaces, members, me.id]);

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

  const fitAll = useCallback(() => {
    if (!located.length) return;
    map.current?.fitToCoordinates(
      located.map((m) => ({ latitude: m.location!.lat, longitude: m.location!.lon })),
      { edgePadding: { top: 190, right: 70, bottom: 70, left: 70 }, animated: true },
    );
  }, [located]);
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
    if (selLoc) map.current?.animateCamera({ center: { latitude: selLoc.lat, longitude: selLoc.lon } }, { duration: 700 });
  }, [selLoc?.lat, selLoc?.lon, selLoc]);

  const selectPerson = (id: string) => {
    void Haptics.selectionAsync();
    setSelectedId(id);
    setSheetIndex(1);
    const loc = members.find((m) => m.id === id)?.location;
    if (loc) map.current?.animateCamera({ center: { latitude: loc.lat, longitude: loc.lon }, zoom: 16 }, { duration: 800 });
  };

  const focusPlace = (p: PlaceWithMeta) => {
    map.current?.animateCamera({ center: { latitude: p.lat, longitude: p.lon }, zoom: 16 }, { duration: 800 });
    setSheetIndex(0);
  };

  const locateMe = async () => {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return router.push('/share-location');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    map.current?.animateCamera({ center: { latitude: p.coords.latitude, longitude: p.coords.longitude }, zoom: 15.5 }, { duration: 700 });
  };

  const chooseMapType = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Map style', options: [...MAP_TYPES.map((m) => m.label), 'Cancel'], cancelButtonIndex: MAP_TYPES.length },
      (i) => {
        const t = MAP_TYPES[i]?.type;
        if (!t) return;
        setMapType(t);
        void setMapTypePref(t);
      },
    );

  const addPlace = (lat: number, lon: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.prompt('New place', 'Name it to see who is there and get arrival and departure alerts — like Home, School or Work.', async (name) => {
      if (!name?.trim()) return;
      try {
        const icon = /home|house/i.test(name) ? 'home' : /work|office/i.test(name) ? 'work' : /school|college|uni/i.test(name) ? 'school' : /gym/i.test(name) ? 'gym' : 'pin';
        await api.post('/api/places', { name: name.trim(), lat, lon, radiusM: 150, icon, color: '#FF6B3D', circleId: circleId ?? circles[0]?.id ?? null });
        qc.invalidateQueries({ queryKey: ['places'] });
        toast({ tone: 'success', title: `${name.trim()} saved`, body: circles.length ? 'Your circle will see arrivals and departures here.' : 'Only you can see this place.' });
      } catch (e) {
        toast({ tone: 'error', title: 'Could not save place', body: (e as Error).message });
      }
    });
  };

  const invite = () => {
    const doInvite = async (id: string, name: string) => {
      try {
        const r = await api.post<{ url: string }>(`/api/circles/${id}/invitations`, { expiresInHours: 72, maxUses: 1 });
        await Share.share({ message: `Join "${name}" on Nodara so we can see where each other are: ${r.url}`, url: r.url });
      } catch (e) {
        toast({ tone: 'error', title: 'Could not create invitation', body: (e as Error).message });
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
        toast({ tone: 'success', title: `${name.trim()} created`, body: 'Invite people with the button at the top of the list.' });
      } catch (e) {
        toast({ tone: 'error', title: 'Could not create circle', body: (e as Error).message });
      }
    });

  const doCheckIn = async (message?: string) => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return router.push('/share-location');
      const deviceId = await ensureDevice();
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const [fix] = await toFixes([pos]);
      const r = await api.post<{ notified: number; where: string | null }>('/api/checkins', { deviceId, circleId, message: message?.trim() || null, location: fix });
      qc.invalidateQueries({ queryKey: ['live'] });
      toast({ tone: 'success', title: r.where ? `Checked in at ${r.where}` : 'Checked in', body: `${r.notified} ${r.notified === 1 ? 'person was' : 'people were'} notified.` });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not check in', body: (e as Error).message });
    }
  };
  const checkIn = () =>
    Alert.prompt(
      'Check in',
      `Let ${circle ? circle.name : 'your circles'} know where you are right now. Add a message if you like.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Check in', onPress: (msg?: string) => void doCheckIn(msg) },
      ],
      'plain-text',
      '',
      'default',
    );

  const mapInset = height - (sheetIndex === 0 ? positions[0] : positions[1]);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <NodaraMap
        ref={map}
        members={members}
        places={places}
        events={events.byUser}
        meId={me.id}
        selectedId={selectedId}
        mapType={mapType}
        region={region}
        bottomInset={mapInset}
        onRegion={setRegion}
        onSelect={selectPerson}
        onLongPress={addPlace}
        onMapPress={() => selectedId && clearSelection()}
      />

      <MapSheet
        y={y}
        index={sheetIndex}
        onIndexChange={setSheetIndex}
        resetKey={selected?.id ?? segment}
        accessory={
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }} pointerEvents="box-none">
            <GlassPill icon="mappin.and.ellipse" label="Check in" sub="Tell your circle" onPress={checkIn} />
            <View style={{ flex: 1 }} pointerEvents="none" />
            <View style={{ gap: 10 }}>
              <GlassButton icon="square.3.layers.3d" label="Map style" onPress={chooseMapType} />
              <GlassButton
                icon={selectedId ? 'person.2.fill' : 'location.fill'}
                label={selectedId ? 'Show everyone' : 'Show my location'}
                onPress={selectedId ? () => (clearSelection(), fitAll()) : () => void locateMe()}
              />
            </View>
          </View>
        }
        header={
          selected ? (
            <ProfileHeader key={selected.id} m={selected} ev={events.byUser.get(selected.id)} onBack={clearSelection} onEdit={() => router.push('/edit-profile')} />
          ) : (
            <Animated.View entering={FadeIn}>
              <View style={styles.sheetHeader}>
                <Text style={[T.title1, { color: C.label }]} numberOfLines={1}>
                  {circle?.name ?? 'Everyone'}
                </Text>
                <Text style={[T.footnote, { color: C.secondaryLabel, marginTop: 2 }]} numberOfLines={2}>
                  {members.length ? circleSummary(members) : 'Nobody here yet'}
                </Text>
              </View>
              <Segmented
                value={segment}
                onChange={setSegment}
                style={{ marginHorizontal: 16, marginBottom: 14 }}
                items={[
                  { key: 'people', label: 'People', icon: 'person.2.fill', count: members.length },
                  { key: 'places', label: 'Places', icon: 'mappin.and.ellipse', count: places.length },
                ]}
              />
            </Animated.View>
          )
        }
      >
        {selected ? (
          <ProfileBody key={selected.id} m={selected} ev={events.byUser.get(selected.id)} onOpenTrip={(id) => router.push(`/trip/${id}`)} />
        ) : segment === 'people' ? (
          <PeoplePanel members={members} events={events.byUser} loading={live.isLoading} onSelect={selectPerson} onInvite={invite} />
        ) : (
          <PlacesPanel places={places} members={members} events={events.list} onFocus={focusPlace} onAdd={() => addPlace(region?.latitude ?? 0, region?.longitude ?? 0)} />
        )}
      </MapSheet>

      <TopBar
        circles={circles}
        circleId={circleId}
        unread={unread?.unread ?? 0}
        onSettings={() => router.push('/settings')}
        onAlerts={() => router.push('/alerts')}
        onSelectCircle={setCircleId}
        onNewCircle={newCircle}
        onInvite={invite}
        onFixSharing={() => (me.sharingPaused ? router.push('/settings') : router.push('/share-location'))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheetHeader: { paddingHorizontal: 20, marginBottom: 12 },
});
