import { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Circle as MapCircle, Marker, type EdgePadding, type MapType, type Region } from 'react-native-maps';
import type { MemberLocation, PlaceWithMeta } from '@/lib/types';
import { ago, firstName, formatSpeed, freshness, type Units } from '@/lib/format';
import { stayDuration } from '@/lib/status';
import { C } from '@/lib/theme';
import { Avatar } from '@/components/ui';
import { liveSpeed, redSpeedMps, speedUnit, speedValue } from '@/lib/driving';
import { PlaceSymbol } from './placeIcons';

/**
 * Marker size follows the zoom level:
 * - near (streets): photo pin with a small name label
 * - mid (city / region): smaller photo, no label
 * - far (province / country): just a small icon
 * People whose markers would overlap on screen merge into one group marker.
 */
export type Tier = 'near' | 'mid' | 'far';
const RED = '#FF3B30';
const SIZE: Record<Tier, number> = { near: 44, mid: 34, far: 22 };
const RING: Record<Tier, number> = { near: 3, mid: 2.5, far: 2 };
const LABEL_H = 22;
const LABEL_GAP = 4;

export const tierFor = (latitudeDelta: number): Tier => (latitudeDelta <= 0.06 ? 'near' : latitudeDelta <= 1.5 ? 'mid' : 'far');

export interface Group {
  key: string;
  lat: number;
  lon: number;
  members: MemberLocation[];
}

/** Merge people whose markers would touch on screen at the current zoom. */
function groupMembers(members: MemberLocation[], region: Region, tier: Tier, screen: { width: number; height: number }): Group[] {
  const ptsPerLat = screen.height / Math.max(region.latitudeDelta, 1e-6);
  const ptsPerLon = screen.width / Math.max(region.longitudeDelta, 1e-6);
  const minGap = SIZE[tier] + RING[tier] * 2 + 8;
  const groups: Group[] = [];
  for (const m of members) {
    const l = m.location!;
    const g = groups.find((x) => Math.hypot((l.lon - x.lon) * ptsPerLon, (l.lat - x.lat) * ptsPerLat) < minGap);
    if (g) {
      g.members.push(m);
      g.lat = g.members.reduce((s, x) => s + x.location!.lat, 0) / g.members.length;
      g.lon = g.members.reduce((s, x) => s + x.location!.lon, 0) / g.members.length;
    } else groups.push({ key: m.id, lat: l.lat, lon: l.lon, members: [m] });
  }
  return groups;
}

/** One short line under a pin: "You · Home, 1 day", "Sam · 54 km/h", "Ana · 3 h ago". */
function labelFor(g: Group, meId: string, units: Units): string {
  const name = (m: MemberLocation) => (m.id === meId ? 'You' : firstName(m.displayName));
  if (g.members.length > 1) {
    const names = g.members.map(name);
    return g.members.length <= 2 ? names.join(' & ') : `${names[0]} +${g.members.length - 1}`;
  }
  const m = g.members[0]!;
  const loc = m.location!;
  const f = freshness(loc.recordedAt);
  let status = '';
  if (liveSpeed(m) != null) status = ''; // the speed badge next to the photo says it
  else if (f === 'live' && (loc.speed ?? 0) > 1.5) status = formatSpeed(loc.speed, units);
  else if (f === 'stale' || f === 'old') status = ago(loc.recordedAt);
  else if (m.currentPlace) {
    const stay = stayDuration(m);
    status = stay ? `${m.currentPlace.name}, ${stay.replace('at least ', '')}` : m.currentPlace.name;
  }
  return status ? `${name(m)} · ${status}` : name(m);
}

export const NodaraMap = forwardRef<
  MapView,
  {
    members: MemberLocation[];
    places: PlaceWithMeta[];
    meId: string;
    units: Units;
    selectedId: string | null;
    mapType: MapType;
    region: Region | null;
    /** Space covered by the sheet and floating buttons at the bottom of the screen. */
    bottomInset: number;
    /** Where Apple's logo and Legal link go so the floating buttons don't cover them. */
    attributionInsets: EdgePadding;
    onRegion: (r: Region) => void;
    onSelect: (id: string) => void;
    onGroupPress: (members: MemberLocation[]) => void;
    onLongPress: (lat: number, lon: number) => void;
    onMapPress: () => void;
  }
>(function NodaraMap({ members, places, meId, units, selectedId, mapType, region, bottomInset, attributionInsets, onRegion, onSelect, onGroupPress, onLongPress, onMapPress }, ref) {
  const screen = useWindowDimensions();
  const view = region ?? { latitude: 0, longitude: 0, latitudeDelta: 0.2, longitudeDelta: 0.2 };
  const tier = tierFor(view.latitudeDelta);
  const located = useMemo(() => members.filter((m) => m.location), [members]);
  // Cheap for family-sized circles; region only changes when a pan or zoom finishes.
  const groups = groupMembers(located, view, tier, screen);
  const occupied = new Set(located.filter((m) => m.currentPlace).map((m) => m.currentPlace!.id));

  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      mapType={mapType}
      // Your own photo pin already shows where you are; the blue dot only appears if it can't.
      showsUserLocation={!located.some((m) => m.id === meId)}
      showsCompass={false}
      showsPointsOfInterests
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomInset }}
      legalLabelInsets={{ ...attributionInsets, left: attributionInsets.left + 48 }}
      appleLogoInsets={attributionInsets}
      onRegionChangeComplete={onRegion}
      onLongPress={(e) => onLongPress(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
      onPress={(e) => {
        // Taps on markers also reach the map; only clear the selection for taps on empty map.
        if ((e.nativeEvent as { action?: string }).action !== 'marker-press') onMapPress();
      }}
      initialRegion={{ latitude: 45.42, longitude: -75.69, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
    >
      {tier !== 'far' &&
        places.map((p) => (
          <MapCircle key={`fence-${p.id}`} center={{ latitude: p.lat, longitude: p.lon }} radius={p.radiusM} strokeColor={p.color} strokeWidth={1.5} fillColor={`${p.color}22`} />
        ))}
      {/* Place names only up close, and not where someone's pin already says it. */}
      {tier === 'near' &&
        places
          .filter((p) => !occupied.has(p.id))
          .map((p) => (
            <Marker key={`place-${p.id}`} coordinate={{ latitude: p.lat, longitude: p.lon }} tracksViewChanges={false}>
              <View collapsable={false} style={styles.placeLabel}>
                <View style={[styles.placeIcon, { backgroundColor: p.color }]}>
                  <PlaceSymbol icon={p.icon} size={10} color="white" />
                </View>
                <Text style={styles.placeText} allowFontScaling={false} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>
            </Marker>
          ))}
      {groups.map((g) => {
        const selected = g.members.some((m) => m.id === selectedId);
        const showLabel = selected || (tier === 'near' && !selectedId);
        const size = SIZE[tier];
        const ring = RING[tier];
        const bubble = size + ring * 2;
        const total = bubble + (showLabel ? LABEL_GAP + LABEL_H : 0);
        const single = g.members.length === 1;
        const label = showLabel ? labelFor(g, meId, units) : null;
        // Speed next to the photo while driving; a red ring over 130 km/h (80 mph).
        const speed = single && tier !== 'far' ? liveSpeed(g.members[0]!) : null;
        const tooFast = g.members.some((m) => (liveSpeed(m) ?? 0) >= redSpeedMps(units));
        const ringColor = tooFast ? RED : selected ? C.accent : 'white';
        return (
          <Marker
            // Re-mount whenever the marker's size could change: react-native-maps only ever grows
            // an annotation's frame, so a changed size would leave the photo off-centre.
            key={`${g.members.map((m) => m.id).join()}:${tier}:${selected ? 's' : ''}:${label ?? ''}`}
            coordinate={{ latitude: g.lat, longitude: g.lon }}
            // Apple Maps centres the view on the coordinate; shift so the photo (not the label) sits on it.
            centerOffset={{ x: 0, y: total / 2 - bubble / 2 }}
            onPress={() => (single ? onSelect(g.members[0]!.id) : onGroupPress(g.members))}
            zIndex={selected ? 3 : 2}
          >
            {/*
              collapsable={false} keeps this wrapper as a real native view. Otherwise React Native
              flattens it away, Apple Maps sizes the pin from the photo alone, and the wider label
              pushes the photo off the real location.
            */}
            <View collapsable={false} style={{ alignItems: 'center' }}>
              <View style={[styles.bubble, { height: bubble, minWidth: bubble, borderRadius: bubble / 2, padding: ring, backgroundColor: ringColor }, tooFast && styles.redGlow]}>
                {g.members.slice(0, 3).map((m, i) => {
                  const f = freshness(m.location!.recordedAt);
                  return (
                    <View key={m.id} style={{ marginLeft: i ? -size * 0.4 : 0, zIndex: 3 - i }}>
                      <Avatar name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={size} dim={f === 'stale' || f === 'old'} />
                    </View>
                  );
                })}
                {g.members.length > 3 && (
                  <Text style={[styles.more, { fontSize: Math.max(10, size * 0.32) }]} allowFontScaling={false}>
                    +{g.members.length - 3}
                  </Text>
                )}
                {speed != null && (
                  // Absolutely positioned, so it never changes the pin's size (and its alignment).
                  <View style={[styles.speed, tier === 'mid' && styles.speedSmall, { left: bubble - (tier === 'near' ? 12 : 10) }, tooFast && { backgroundColor: RED }]}>
                    <Text style={[styles.speedValue, tier === 'mid' && { fontSize: 11 }]} allowFontScaling={false}>
                      {speedValue(speed, units)}
                    </Text>
                    <Text style={styles.speedUnit} allowFontScaling={false}>
                      {speedUnit(units)}
                    </Text>
                  </View>
                )}
              </View>
              {label && (
                <View style={styles.label}>
                  <Text style={styles.labelText} allowFontScaling={false} numberOfLines={1}>
                    {label}
                  </Text>
                </View>
              )}
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
});

const styles = StyleSheet.create({
  placeLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.92)', paddingLeft: 2, paddingRight: 7, height: 20, borderRadius: 10 },
  placeIcon: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  placeText: { fontSize: 11, fontWeight: '700', color: '#1c1c1e', maxWidth: 140 },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  more: { marginHorizontal: 5, fontWeight: '800', color: '#1c1c1e' },
  redGlow: { shadowColor: RED, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  speed: {
    position: 'absolute',
    top: -7,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    paddingTop: 3,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: 'white',
  },
  speedSmall: { top: -6, height: 18, paddingHorizontal: 5, paddingTop: 1.5, borderRadius: 9 },
  speedValue: { fontSize: 13, fontWeight: '800', color: 'white', fontVariant: ['tabular-nums'] },
  speedUnit: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  label: {
    marginTop: LABEL_GAP,
    height: LABEL_H,
    paddingHorizontal: 8,
    borderRadius: LABEL_H / 2,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  labelText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#1c1c1e', maxWidth: 180 },
});
