// API shapes are shared with the server and web app. Type-only imports are
// erased at build time, so Metro never needs to bundle the shared package.
import type { TripSummary } from '@shared/types';

export type {
  AppNotification,
  Circle,
  LocationFix,
  Me,
  MemberLocation,
  Place,
  PublicConfig,
  ServerEvent,
  TripSummary,
  UserPreferences,
} from '@shared/types';


export type TravelMode = 'walking' | 'cycling' | 'driving' | 'unknown';
export interface Trip extends TripSummary {
  mode: TravelMode;
}
export interface TripDetail extends Trip {
  movingSec: number;
  pointCount: number;
  route: [number, number][];
  stops: { lat: number; lon: number; arrivedAt: string; departedAt: string; durationSec: number }[];
  samples: { t: string; speed: number | null; source: string }[];
}
export interface CircleMember {
  id: string;
  displayName: string;
  email: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  role: 'owner' | 'admin' | 'member';
  sharing: boolean;
  joinedAt: string;
}
export interface CircleDetail {
  id: string;
  name: string;
  color: string;
  role: 'owner' | 'admin' | 'member';
  sharing: boolean;
  memberCount: number;
  settings: { historyVisible: boolean; tripsVisible: boolean; membersCanInvite: boolean };
  notify: { muted: boolean };
  members: CircleMember[];
}
export interface PlaceWithMeta {
  id: string;
  ownerId: string;
  circleId: string | null;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  icon: string;
  color: string;
  membersInside: string[];
  canEdit: boolean;
}
export interface PlaceEvent {
  id: string;
  kind: 'arrive' | 'depart';
  occurredAt: string;
  user: { id: string; displayName: string; avatarColor: string; avatarUrl: string | null };
  place: { id: string; name: string; icon: string; color: string };
}

export type NotifyKey = 'places' | 'circle' | 'sharing' | 'lowBattery' | 'deviceOffline';
export type NotifyPrefs = Partial<Record<NotifyKey, { inApp?: boolean; push?: boolean }>>;

export interface Device {
  id: string;
  name: string;
  kind: string;
  tokenHint: string | null;
  pushEnabled: boolean;
  lastSeenAt: string | null;
  lastLocationAt: string | null;
  createdAt: string;
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
