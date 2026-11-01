import type { Circle, CircleRole, LocationFix, Place, TripSummary } from '@nodara/shared';

export type { AppNotification, Circle, LocationFix, Me, MemberLocation, Place, PublicConfig, TripSummary } from '@nodara/shared';

export interface CircleMember {
  id: string;
  displayName: string;
  email: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  role: CircleRole;
  sharing: boolean;
  joinedAt: string;
}

export interface CircleDetail extends Circle {
  notify: { muted: boolean };
  members: CircleMember[];
}

export interface Invitation {
  id: string;
  role: 'admin' | 'member';
  maxUses: number;
  uses: number;
  expiresAt: string;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
}

export interface Device {
  id: string;
  name: string;
  kind: 'web' | 'ios' | 'android' | 'owntracks' | 'overland' | 'other';
  tokenHint: string | null;
  pushEnabled: boolean;
  lastSeenAt: string | null;
  lastLocationAt: string | null;
  createdAt: string;
}

export type TravelMode = 'walking' | 'cycling' | 'driving' | 'unknown';
export interface Trip extends TripSummary {
  mode: TravelMode;
}

export interface TripStop {
  lat: number;
  lon: number;
  arrivedAt: string;
  departedAt: string;
  durationSec: number;
}

export interface TripDetail extends Trip {
  movingSec: number;
  pointCount: number;
  route: [number, number][];
  stops: TripStop[];
  samples: { t: string; speed: number | null; source: string; accuracy: number | null; lat: number; lon: number; altitude: number | null }[];
}

export interface HistoryPoints {
  points: LocationFix[];
  total: number;
  decimated: boolean;
  distanceM: number;
  visibleSince: string | null;
}

export interface HistoryDay {
  date: string;
  points: number;
  distanceM: number;
  trips: number;
  firstAt: string;
  lastAt: string;
}

export type TimelineItem =
  | { type: 'stay'; startAt: string; endAt: string; lat: number; lon: number; label: string | null; placeId: string | null }
  | { type: 'trip'; trip: Trip };

export interface Totals {
  trips: number;
  distanceM: number;
  durationSec: number;
  avgTripDistanceM: number;
  avgSpeed: number | null;
  maxSpeed: number | null;
}

export interface Insights {
  period: 'week' | 'month' | 'year';
  start: string;
  end: string;
  current: Totals;
  previous: Totals;
  buckets: { date: string; trips: number; distanceM: number; durationSec: number }[];
  note: string;
}

export interface PlaceWithMeta extends Place {
  membersInside: string[];
  alertCount: number;
  canEdit: boolean;
}

export interface PlaceAlert {
  memberId: string | null;
  onArrive: boolean;
  onDepart: boolean;
}

export interface PlaceEvent {
  id: string;
  kind: 'arrive' | 'depart';
  occurredAt: string;
  user: { id: string; displayName: string; avatarColor: string; avatarUrl: string | null };
  place: { id: string; name: string; icon: string; color: string };
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
