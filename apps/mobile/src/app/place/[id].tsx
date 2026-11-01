import { useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import MapView, { type MapType, type Region } from 'react-native-maps';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { useAddress, useCircles, usePlaces } from '@/lib/queries';
import { formatDistance } from '@/lib/format';
import { MAP_TYPES } from '@/lib/prefs';
import { C, T } from '@/lib/theme';
import type { CircleDetail, PlaceWithMeta } from '@/lib/types';
import { Avatar, GlassButton, Row, Section, Skeleton, Tap, useToast } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { PLACE_SYMBOLS, PlaceSymbol } from '@/features/home/placeIcons';

const MAP_H = 300;
const MIN_R = 50;
const MAX_R = 2000;
const METERS_PER_DEG = 111_320;
const ICONS = Object.keys(PLACE_SYMBOLS);
const COLORS = ['#FF6B3D', '#FF3B30', '#FF9500', '#F5A524', '#34C759', '#13C2C2', '#007AFF', '#5856D6', '#AF52DE', '#F56A9A'];

// Finer control for small zones: the slider position is the square root of the radius range.
const toSlider = (r: number) => Math.sqrt((Math.min(MAX_R, Math.max(MIN_R, r)) - MIN_R) / (MAX_R - MIN_R));
const fromSlider = (t: number) => {
  const r = MIN_R + (MAX_R - MIN_R) * t * t;
  return r < 500 ? Math.round(r / 5) * 5 : Math.round(r / 25) * 25;
};
/** Zoom so the zone fills about 40% of the map's height. */
const deltaFor = (r: number) => (r * 2 * 2.5) / METERS_PER_DEG;

type Alerts = Record<string, { arrive: boolean; leave: boolean }>;

/**
 * Create or edit a place: move the map under the pin to place it, size the
 * zone, name it, pick an icon and colour, choose who it's shared with, and
 * choose whose arrivals and departures you get told about.
 */
export default function PlaceEditor() {
  const params = useLocalSearchParams<{ id: string; lat?: string; lon?: string; circleId?: string }>();
  const isNew = params.id === 'new';
  const { data: places, isLoading } = usePlaces();
  const place = isNew ? null : (places?.find((p) => p.id === params.id) ?? null);

  if (!isNew && isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.groupedBackground, padding: 16, gap: 12 }}>
        <Skeleton height={MAP_H} />
        <Skeleton height={120} />
      </View>
    );
  }
  if (!isNew && !place) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.groupedBackground }}>
        <Text style={[T.headline, { color: C.secondaryLabel }]}>This place no longer exists.</Text>
      </View>
    );
  }
  return <Editor place={place} start={place ? { lat: place.lat, lon: place.lon } : { lat: Number(params.lat) || 0, lon: Number(params.lon) || 0 }} defaultCircle={params.circleId} />;
}

function Editor({ place, start, defaultCircle }: { place: PlaceWithMeta | null; start: { lat: number; lon: number }; defaultCircle?: string }) {
  const me = useMe();
  const { config } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const map = useRef<MapView>(null);
  const units = me.preferences.units;
  const { data: circles = [] } = useCircles();
  const editable = !place || place.canEdit;

  const [name, setName] = useState(place?.name ?? '');
  const [radius, setRadius] = useState(place?.radiusM ?? 150);
  const [icon, setIcon] = useState(place?.icon ?? 'home');
  const [color, setColor] = useState(place?.color ?? '#FF6B3D');
  // New places are shared with the circle you're looking at (or your first one) unless you pick otherwise.
  const [pickedCircle, setCircleId] = useState<string | null | undefined>(place ? place.circleId : undefined);
  const circleId = pickedCircle !== undefined ? pickedCircle : (circles.find((c) => c.id === defaultCircle)?.id ?? circles[0]?.id ?? null);
  const [center, setCenter] = useState(start);
  const [latDelta, setLatDelta] = useState(deltaFor(place?.radiusM ?? 150));
  const [settled, setSettled] = useState(start);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [saving, setSaving] = useState(false);
  const { data: address, isFetching: finding } = useAddress(settled.lat, settled.lon);

  // People in the place's circle, and which of their arrivals/departures you want to hear about.
  const sharedWith = circleId;
  const circle = useQuery({ queryKey: ['circle', sharedWith], enabled: Boolean(sharedWith), queryFn: () => api.get<CircleDetail>(`/api/circles/${sharedWith}`) });
  const others = useMemo(() => (circle.data?.members ?? []).filter((m) => m.id !== me.id), [circle.data, me.id]);
  const saved = useQuery({
    queryKey: ['place-alerts', place?.id],
    enabled: Boolean(place?.circleId),
    queryFn: () => api.get<{ memberId: string | null; onArrive: boolean; onDepart: boolean }[]>(`/api/places/${place!.id}/alerts`),
  });
  const [alertEdits, setAlertEdits] = useState<Alerts>({});
  const alertsFor = (id: string) => {
    if (alertEdits[id]) return alertEdits[id]!;
    if (!place) return { arrive: true, leave: true }; // new shared places: tell me about everyone, like the server default
    const rows = saved.data ?? [];
    const own = rows.find((r) => r.memberId === id) ?? rows.find((r) => r.memberId === null);
    return { arrive: Boolean(own?.onArrive), leave: Boolean(own?.onDepart) };
  };
  const setAlert = (id: string, key: 'arrive' | 'leave', on: boolean) => setAlertEdits((a) => ({ ...a, [id]: { ...alertsFor(id), [key]: on } }));
  const alertsDirty = Object.keys(alertEdits).length > 0;

  const zonePts = Math.min(MAP_H * 3, (2 * radius * MAP_H) / (latDelta * METERS_PER_DEG));
  const moved = !place || Math.abs(center.lat - place.lat) > 1e-6 || Math.abs(center.lon - place.lon) > 1e-6;
  const dirty = !place || moved || name.trim() !== place.name || radius !== place.radiusM || icon !== place.icon || color !== place.color || circleId !== place.circleId || alertsDirty;

  // While the map moves, only zooming matters (the zone circle's size); the pin is always the map centre.
  const onRegionChanging = (r: Region) => {
    if (Math.abs(r.latitudeDelta - latDelta) > latDelta * 0.01) setLatDelta(r.latitudeDelta);
  };
  const onRegion = (r: Region) => {
    setCenter({ lat: r.latitude, lon: r.longitude });
    setLatDelta(r.latitudeDelta);
  };

  const refit = (r = radius) => {
    map.current?.animateToRegion({ latitude: center.lat, longitude: center.lon, latitudeDelta: deltaFor(r), longitudeDelta: deltaFor(r) }, 350);
  };

  const search = () =>
    Alert.prompt('Find an address', undefined, async (q) => {
      if (!q || q.trim().length < 2) return;
      try {
        const r = await api.get<{ results: { label: string; lat: number; lon: number }[] }>(`/api/geocode/search?q=${encodeURIComponent(q.trim())}&lat=${center.lat}&lon=${center.lon}`);
        const results = r.results.slice(0, 6);
        if (!results.length) return toast({ tone: 'info', title: 'Nothing found', body: 'Try a street address or a business name.' });
        ActionSheetIOS.showActionSheetWithOptions({ title: 'Move the place to…', options: [...results.map((x) => x.label), 'Cancel'], cancelButtonIndex: results.length }, (i) => {
          const hit = results[i];
          if (hit) map.current?.animateToRegion({ latitude: hit.lat, longitude: hit.lon, latitudeDelta: deltaFor(radius), longitudeDelta: deltaFor(radius) }, 500);
        });
      } catch (e) {
        toast({ tone: 'error', title: 'Search failed', body: (e as Error).message });
      }
    });

  const save = async () => {
    if (editable && !name.trim()) return toast({ tone: 'error', title: 'Give the place a name', body: 'Like Home, School or Work.' });
    setSaving(true);
    try {
      let id = place?.id;
      const details = { name: name.trim(), radiusM: radius, icon, color, circleId, ...(moved ? { lat: center.lat, lon: center.lon, address: address ?? null } : {}) };
      if (!place) {
        id = (await api.post<{ id: string }>('/api/places', { ...details, lat: center.lat, lon: center.lon, address: address ?? null })).id;
      } else if (editable) {
        await api.patch(`/api/places/${place.id}`, details);
      }
      if (id && sharedWith && alertsDirty) {
        await api.put(`/api/places/${id}/alerts`, {
          alerts: others.map((m) => {
            const a = alertsFor(m.id);
            return { memberId: m.id, onArrive: a.arrive, onDepart: a.leave };
          }),
        });
      }
      qc.invalidateQueries({ queryKey: ['places'] });
      qc.invalidateQueries({ queryKey: ['place-alerts'] });
      qc.invalidateQueries({ queryKey: ['live'] });
      toast({ tone: 'success', title: place ? `${name.trim() || place.name} saved` : `${name.trim()} added`, body: sharedWith ? 'Your circle sees it too.' : 'Only you can see this place.' });
      router.back();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert(`Delete ${place!.name}?`, 'Arrival and departure alerts for it stop for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/api/places/${place!.id}`);
            qc.invalidateQueries({ queryKey: ['places'] });
            router.back();
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete', body: (e as Error).message });
          }
        },
      },
    ]);

  const chooseMapType = () =>
    ActionSheetIOS.showActionSheetWithOptions({ options: [...MAP_TYPES.map((m) => m.label), 'Cancel'], cancelButtonIndex: MAP_TYPES.length }, (i) => {
      const t = MAP_TYPES[i]?.type;
      if (t) setMapType(t);
    });

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.groupedBackground }}>
      <Stack.Screen options={{ title: place ? (editable ? 'Edit place' : place.name) : 'New place' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={!dirty || saving} onPress={() => void save()} accessibilityLabel="Save">
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Map: move it under the pin to place the zone. */}
        <View style={{ height: MAP_H }}>
          <MapView
            ref={map}
            style={StyleSheet.absoluteFill}
            mapType={mapType}
            initialRegion={{ latitude: start.lat, longitude: start.lon, latitudeDelta: deltaFor(radius), longitudeDelta: deltaFor(radius) }}
            onRegionChange={onRegionChanging}
            onRegionChangeComplete={(r) => {
              onRegion(r);
              setSettled({ lat: Number(r.latitude.toFixed(5)), lon: Number(r.longitude.toFixed(5)) });
            }}
            scrollEnabled={editable}
            rotateEnabled={false}
            pitchEnabled={false}
            showsUserLocation
            showsPointsOfInterests
          />
          <View pointerEvents="none" style={styles.center}>
            <View style={{ width: zonePts, height: zonePts, borderRadius: zonePts / 2, backgroundColor: `${color}2E`, borderWidth: 2, borderColor: color }} />
          </View>
          <View pointerEvents="none" style={styles.center}>
            <View style={[styles.pin, { borderColor: color }]}>
              <PlaceSymbol icon={icon} size={20} color={color} />
            </View>
          </View>
          <View style={styles.mapButtons}>
            <GlassButton icon="square.3.layers.3d" label="Map style" onPress={chooseMapType} size={42} />
          </View>
          {editable && (
            <View pointerEvents="none" style={styles.hint}>
              <Text style={styles.hintText}>Move the map to place the pin</Text>
            </View>
          )}
        </View>

        {/* Zone size */}
        {editable && (
          <View style={styles.radiusRow}>
            <View style={{ flex: 1 }}>
              <Slider
                value={toSlider(radius)}
                onChange={(t) => setRadius(fromSlider(t))}
                onCommit={(t) => {
                  const r = fromSlider(t);
                  const pts = (2 * r * MAP_H) / (latDelta * METERS_PER_DEG);
                  if (pts > MAP_H * 0.85 || pts < MAP_H * 0.15) refit(r);
                }}
                color={color}
                accessibilityLabel="Zone size"
                accessibilityValue={formatDistance(radius, units)}
                onAccessibilityStep={(d) => setRadius((r) => Math.min(MAX_R, Math.max(MIN_R, r + d * (r < 200 ? 10 : r < 600 ? 25 : 100))))}
              />
            </View>
            <Text style={[T.headline, { color: C.label, minWidth: 92, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{formatDistance(radius, units)} zone</Text>
          </View>
        )}

        <View style={{ height: 24 }} />

        <Section title="Place details">
          <View style={styles.field}>
            <SymbolView name="bookmark.fill" size={18} tintColor={C.secondaryLabel} />
            <TextInput
              value={name}
              onChangeText={setName}
              editable={editable}
              placeholder="Name (Home, School, Work…)"
              placeholderTextColor={C.tertiaryLabel}
              style={styles.input}
              maxLength={60}
              returnKeyType="done"
              autoCapitalize="words"
            />
          </View>
          <Tap onPress={config?.geocoding && editable ? search : undefined} disabled={!config?.geocoding || !editable} style={[styles.field, { borderBottomWidth: 0 }]} haptic="none" accessibilityRole={config?.geocoding && editable ? 'button' : undefined} accessibilityHint="Search for an address">
            <SymbolView name="mappin" size={18} tintColor={C.secondaryLabel} />
            <Text style={[styles.input, { color: address ? C.label : C.secondaryLabel }]} numberOfLines={2}>
              {finding && !address ? 'Finding the address…' : (address ?? `${settled.lat.toFixed(5)}, ${settled.lon.toFixed(5)}`)}
            </Text>
            {config?.geocoding && editable ? <SymbolView name="magnifyingglass" size={16} tintColor={C.accent} /> : finding ? <ActivityIndicator /> : null}
          </Tap>
        </Section>

        {editable && (
          <Section title="Icon and colour">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickRow}>
              {ICONS.map((i) => (
                <Tap key={i} onPress={() => setIcon(i)} style={[styles.iconChoice, i === icon && { backgroundColor: color }]} accessibilityRole="radio" accessibilityState={{ selected: i === icon }} accessibilityLabel={i}>
                  <PlaceSymbol icon={i} size={18} color={i === icon ? 'white' : C.label} />
                </Tap>
              ))}
            </ScrollView>
            <View style={[styles.pickRow, { paddingTop: 0, flexWrap: 'wrap' }]}>
              {COLORS.map((c) => (
                <Tap key={c} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchOn]} accessibilityRole="radio" accessibilityState={{ selected: c === color }} accessibilityLabel={`Colour ${c}`}>
                  {c === color && <SymbolView name="checkmark" size={14} weight="bold" tintColor="white" />}
                </Tap>
              ))}
            </View>
          </Section>
        )}

        {editable && (
          <Section title="Shared with" footer={circleId ? 'Everyone in this circle sees the place and can get alerts for it.' : 'Only you see this place. Alerts need a shared place.'}>
            <Row icon="lock.fill" iconColor="#8E8E93" title="Only me" onPress={() => setCircleId(null)} accessory={circleId === null ? <SymbolView name="checkmark" size={17} weight="semibold" tintColor={C.accent} /> : <View />} last={!circles.length} />
            {circles.map((c, i) => (
              <Row
                key={c.id}
                icon="person.2.fill"
                iconColor={c.color}
                title={c.name}
                subtitle={`${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
                onPress={() => setCircleId(c.id)}
                accessory={circleId === c.id ? <SymbolView name="checkmark" size={17} weight="semibold" tintColor={C.accent} /> : <View />}
                last={i === circles.length - 1}
              />
            ))}
          </Section>
        )}

        <Section title="Get notified when…" footer={sharedWith && others.length ? 'You get a notification when someone you picked arrives at or leaves this place.' : undefined}>
          {!sharedWith ? (
            <Text style={styles.empty}>Share this place with a circle to get told when people arrive or leave.</Text>
          ) : circle.isLoading || (place && saved.isLoading) ? (
            <View style={{ padding: 16 }}>
              <ActivityIndicator />
            </View>
          ) : !others.length ? (
            <Text style={styles.empty}>Nobody else is in this circle yet. Invite someone to get alerts about them here.</Text>
          ) : (
            others.map((m, i) => {
              const a = alertsFor(m.id);
              return (
                <View key={m.id} style={[styles.person, i < others.length - 1 && styles.divider]}>
                  <Avatar name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={48} />
                  <View style={{ flex: 1, gap: 10 }}>
                    <Text style={[T.headline, { color: C.label }]} numberOfLines={1}>
                      {m.displayName}
                    </Text>
                    <View style={styles.switchRow}>
                      <Text style={[T.body, { color: C.label }]}>Arrives</Text>
                      <Switch value={a.arrive} onValueChange={(v) => setAlert(m.id, 'arrive', v)} trackColor={{ true: color }} accessibilityLabel={`Tell me when ${m.displayName} arrives`} />
                    </View>
                    <View style={styles.switchRow}>
                      <Text style={[T.body, { color: C.label }]}>Leaves</Text>
                      <Switch value={a.leave} onValueChange={(v) => setAlert(m.id, 'leave', v)} trackColor={{ true: color }} accessibilityLabel={`Tell me when ${m.displayName} leaves`} />
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </Section>

        {place && editable && (
          <Section>
            <Row title="Delete place" destructive onPress={remove} last />
          </Section>
        )}
        {place && !editable && <Text style={styles.empty}>Only the person who added this place or a circle admin can change it. You can still choose your own alerts.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pin: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'white',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  mapButtons: { position: 'absolute', right: 12, bottom: 12 },
  hint: { position: 'absolute', top: 10, alignSelf: 'center', paddingHorizontal: 12, height: 28, borderRadius: 14, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  hintText: { color: 'white', fontSize: 13, fontWeight: '600' },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 10, backgroundColor: C.cell, paddingBottom: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator },
  input: { flex: 1, fontSize: 17, color: C.label, paddingVertical: 14 },
  pickRow: { flexDirection: 'row', gap: 10, padding: 14 },
  iconChoice: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: C.fill },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: 'white', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  empty: { fontSize: 15, lineHeight: 20, color: C.secondaryLabel, padding: 16 },
  person: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
