import { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle as MapCircle, Marker, type MapType, type Region } from 'react-native-maps';
import type { MemberLocation, PlaceEvent, PlaceWithMeta } from '@/lib/types';
import { ago, clock, firstName, freshness, haversine, initials } from '@/lib/format';
import { C } from '@/lib/theme';
import { PlaceSymbol } from './placeIcons';

interface Group {
  key: string;
  lat: number;
  lon: number;
  members: MemberLocation[];
}

/** Merge people standing close together (relative to the zoom level) into one marker. */
function groupMembers(members: MemberLocation[], region: Region | null): Group[] {
  const threshold = region ? region.latitudeDelta * 111_000 * 0.06 : 60;
  const groups: Group[] = [];
  for (const m of members) {
    const l = m.location!;
    const g = groups.find((x) => haversine(x.lat, x.lon, l.lat, l.lon) < threshold);
    if (g) g.members.push(m);
    else groups.push({ key: m.id, lat: l.lat, lon: l.lon, members: [m] });
  }
  return groups;
}

/** "Sam arrived · 3 h ago", "Sam left Work · 12 min ago", "Live · 42 km/h"… */
function calloutFor(m: MemberLocation, ev: PlaceEvent | undefined): { icon?: string; color?: string; line1: string; line2: string } | null {
  const loc = m.location!;
  const f = freshness(loc.recordedAt);
  if (m.currentPlace && ev?.kind === 'arrive' && ev.place.id === m.currentPlace.id) {
    return { icon: m.currentPlace.icon, color: m.currentPlace.color, line1: `${firstName(m.displayName)} arrived`, line2: ago(ev.occurredAt) };
  }
  if (m.currentPlace) return { icon: m.currentPlace.icon, color: m.currentPlace.color, line1: `${firstName(m.displayName)} at ${m.currentPlace.name}`, line2: f === 'live' ? 'Now' : ago(loc.recordedAt) };
  if (ev?.kind === 'depart' && Date.now() - Date.parse(ev.occurredAt) < 3 * 3600_000) {
    return { icon: ev.place.icon, color: ev.place.color, line1: `${firstName(m.displayName)} left ${ev.place.name}`, line2: ago(ev.occurredAt) };
  }
  if (f === 'stale' || f === 'old') return { line1: `${firstName(m.displayName)} · last seen`, line2: `${ago(loc.recordedAt)} (${clock(loc.recordedAt)})` };
  return null;
}

export const NodaraMap = forwardRef<
  MapView,
  {
    members: MemberLocation[];
    places: PlaceWithMeta[];
    events: Map<string, PlaceEvent>;
    meId: string;
    selectedId: string | null;
    mapType: MapType;
    region: Region | null;
    bottomInset: number;
    onRegion: (r: Region) => void;
    onSelect: (id: string) => void;
    onLongPress: (lat: number, lon: number) => void;
    onMapPress: () => void;
  }
>(function NodaraMap({ members, places, events, meId, selectedId, mapType, region, bottomInset, onRegion, onSelect, onLongPress, onMapPress }, ref) {
  const located = useMemo(() => members.filter((m) => m.location), [members]);
  const groups = useMemo(() => groupMembers(located, region), [located, region]);

  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      mapType={mapType}
      showsUserLocation
      showsCompass={false}
      showsPointsOfInterests
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomInset }}
      onRegionChangeComplete={onRegion}
      onLongPress={(e) => onLongPress(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
      onPress={(e) => {
        // Taps on markers also reach the map; only clear the selection for taps on empty map.
        if ((e.nativeEvent as { action?: string }).action !== 'marker-press') onMapPress();
      }}
      initialRegion={{ latitude: 45.42, longitude: -75.69, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
    >
      {places.map((p) => (
        <MapCircle key={`fence-${p.id}`} center={{ latitude: p.lat, longitude: p.lon }} radius={p.radiusM} strokeColor={p.color} strokeWidth={1.5} fillColor={`${p.color}26`} />
      ))}
      {places.map((p) => (
        <Marker key={`place-${p.id}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={styles.placeLabel}>
            <View style={[styles.placeIcon, { backgroundColor: p.color }]}>
              <PlaceSymbol icon={p.icon} size={11} color="white" />
            </View>
            <Text style={styles.placeText}>{p.name}</Text>
          </View>
        </Marker>
      ))}
      {groups.map((g) => {
        const focus = g.members.find((m) => m.id === selectedId) ?? g.members.find((m) => m.id !== meId) ?? g.members[0]!;
        const selected = g.members.some((m) => m.id === selectedId);
        // With someone selected, only their callout shows, to keep the map calm.
        const callout = selectedId && !selected ? null : calloutFor(focus, events.get(focus.id));
        return (
          <Marker key={g.members.map((m) => m.id).join()} coordinate={{ latitude: g.lat, longitude: g.lon }} anchor={{ x: 0.5, y: 1 }} onPress={() => onSelect(focus.id)} zIndex={selected ? 3 : 2}>
            <View style={{ alignItems: 'center' }}>
              {callout && (
                <View style={styles.callout}>
                  {callout.icon && (
                    <View style={[styles.calloutIcon, { backgroundColor: callout.color ?? C.accent }]}>
                      <PlaceSymbol icon={callout.icon} size={13} color="white" />
                    </View>
                  )}
                  <View>
                    <Text style={styles.calloutLine1}>{callout.line1}</Text>
                    <Text style={styles.calloutLine2}>{callout.line2}</Text>
                  </View>
                </View>
              )}
              <View style={[styles.bubble, selected && { borderColor: C.accent }]}>
                {g.members.slice(0, 3).map((m, i) => {
                  const f = freshness(m.location!.recordedAt);
                  const stale = f === 'stale' || f === 'old';
                  return (
                    <View key={m.id} style={[styles.face, { backgroundColor: stale ? '#8E8E93' : m.avatarColor, marginLeft: i ? -14 : 0, zIndex: 3 - i }]}>
                      <Text style={styles.faceText}>{initials(m.displayName)}</Text>
                    </View>
                  );
                })}
                {g.members.length > 3 && <Text style={styles.more}>+{g.members.length - 3}</Text>}
              </View>
              <View style={[styles.tail, selected && { backgroundColor: C.accent }]} />
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
});

const styles = StyleSheet.create({
  placeLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.94)', paddingLeft: 3, paddingRight: 8, paddingVertical: 3, borderRadius: 12 },
  placeIcon: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  placeText: { fontSize: 12, fontWeight: '700', color: '#1c1c1e' },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.97)',
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 18,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  calloutIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  calloutLine1: { fontSize: 13, color: '#3c3c43' },
  calloutLine2: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    backgroundColor: 'white',
    borderRadius: 40,
    borderWidth: 3,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  face: { width: 52, height: 52, borderRadius: 26, borderWidth: 2.5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
  faceText: { color: 'white', fontSize: 18, fontWeight: '700' },
  more: { marginHorizontal: 8, fontWeight: '700', color: '#1c1c1e' },
  tail: { width: 14, height: 14, backgroundColor: 'white', transform: [{ rotate: '45deg' }], marginTop: -9 },
});
