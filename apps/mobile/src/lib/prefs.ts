import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MapType } from 'react-native-maps';

/** Preferences that only matter on this iPhone (not synced to the server). */
export const MAP_TYPE_KEY = 'nodara.mapType';
export const MAP_TYPES: { type: MapType; label: string }[] = [
  { type: 'standard', label: 'Standard' },
  { type: 'mutedStandard', label: 'Muted' },
  { type: 'satellite', label: 'Satellite' },
  { type: 'hybrid', label: 'Hybrid' },
];

export async function getMapType(): Promise<MapType | null> {
  const v = await AsyncStorage.getItem(MAP_TYPE_KEY);
  return MAP_TYPES.some((m) => m.type === v) ? (v as MapType) : null;
}

export const setMapTypePref = (t: MapType) => AsyncStorage.setItem(MAP_TYPE_KEY, t);
