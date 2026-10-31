import type { LocationFix, Place, SpeedSource, TripSummary } from '@nodara/shared';

export interface LocationRow {
  id: number;
  user_id: string;
  device_id: string | null;
  recorded_at: Date;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  speed_source: SpeedSource;
  heading: number | null;
  battery: number | null;
  charging: boolean | null;
  activity: string | null;
}

export const LOCATION_COLUMNS = [
  'id', 'user_id', 'device_id', 'recorded_at', 'lat', 'lon', 'accuracy', 'altitude',
  'speed', 'speed_source', 'heading', 'battery', 'charging', 'activity',
] as const;

export function serializeLocation(r: LocationRow): LocationFix {
  return {
    id: String(r.id),
    userId: r.user_id,
    deviceId: r.device_id,
    recordedAt: r.recorded_at.toISOString(),
    lat: r.lat,
    lon: r.lon,
    accuracy: r.accuracy,
    altitude: r.altitude,
    speed: r.speed,
    speedSource: r.speed_source,
    heading: r.heading,
    battery: r.battery,
    charging: r.charging,
    activity: r.activity,
  };
}

export interface TripRow {
  id: string;
  user_id: string;
  status: 'in_progress' | 'completed';
  started_at: Date;
  ended_at: Date | null;
  duration_sec: number;
  distance_m: number;
  max_speed: number | null;
  avg_moving_speed: number | null;
  avg_speed: number | null;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  start_label: string | null;
  end_label: string | null;
  stops: unknown[];
  low_confidence: boolean;
}

export const TRIP_COLUMNS = [
  'id', 'user_id', 'status', 'started_at', 'ended_at', 'duration_sec', 'distance_m', 'max_speed',
  'avg_moving_speed', 'avg_speed', 'start_lat', 'start_lon', 'end_lat', 'end_lon', 'start_label',
  'end_label', 'stops', 'low_confidence',
] as const;

export function serializeTrip(r: TripRow): TripSummary {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at?.toISOString() ?? null,
    durationSec: r.duration_sec,
    distanceM: r.distance_m,
    maxSpeed: r.max_speed,
    avgMovingSpeed: r.avg_moving_speed,
    avgSpeed: r.avg_speed,
    startLat: r.start_lat,
    startLon: r.start_lon,
    endLat: r.end_lat,
    endLon: r.end_lon,
    startLabel: r.start_label,
    endLabel: r.end_label,
    stopCount: r.stops.length,
    lowConfidence: r.low_confidence,
  };
}

export interface PlaceRow {
  id: string;
  owner_id: string;
  circle_id: string | null;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  icon: string;
  color: string;
  address: string | null;
  created_at: Date;
}

export const PLACE_COLUMNS = [
  'id', 'owner_id', 'circle_id', 'name', 'lat', 'lon', 'radius_m', 'icon', 'color', 'address', 'created_at',
] as const;

export function serializePlace(r: PlaceRow): Place {
  return {
    id: r.id,
    ownerId: r.owner_id,
    circleId: r.circle_id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    radiusM: r.radius_m,
    icon: r.icon,
    color: r.color,
    address: r.address,
    createdAt: r.created_at.toISOString(),
  };
}
