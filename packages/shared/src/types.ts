// Types shared between the Nodara server and web client. They describe the
// public JSON shapes of the REST + WebSocket API.

import type { UnitSystem } from './units.js';

export type CircleRole = 'owner' | 'admin' | 'member';
export type RegistrationPolicy = 'open' | 'invite' | 'closed';
export type SpeedSource = 'gps' | 'derived' | 'none';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface PublicUser {
  id: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
}

export interface Me extends PublicUser {
  email: string;
  emailVerified: boolean;
  /** New address waiting to be confirmed with the emailed code. */
  pendingEmail?: string | null;
  isAdmin: boolean;
  isDemo: boolean;
  sharingPaused: boolean;
  totpEnabled: boolean;
  passkeyCount: number;
  createdAt: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  units: UnitSystem;
  theme: ThemePreference;
  mapStyle: string | null;
  updateIntervalSec: number;
  adaptiveInterval: boolean;
  highAccuracy: boolean;
  retentionDays: number | null;
  notifyLowBattery: boolean;
  lowBatteryThreshold: number;
}

export interface LocationFix {
  id: string;
  userId: string;
  deviceId: string | null;
  recordedAt: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  speedSource: SpeedSource;
  heading: number | null;
  battery: number | null;
  charging: boolean | null;
  activity: string | null;
}

export interface MemberLocation extends PublicUser {
  role: CircleRole;
  sharing: boolean;
  location: LocationFix | null;
  deviceName: string | null;
  currentPlace: { id: string; name: string; icon: string; color: string } | null;
  inTrip: boolean;
  /**
   * When they arrived where they are now (null while travelling or unknown).
   * `atLeast` is true when the real arrival is earlier than what the viewer may
   * see (before they started sharing, or before recorded history begins).
   */
  stay: { since: string; atLeast: boolean } | null;
  /**
   * The trip they're on right now, if any. `stoppedSince` is set while they're
   * standing still (a red light, a drive-thru), so apps can show 0 km/h and
   * stop showing a speed once they've clearly parked.
   */
  currentTrip?: { startedAt: string; maxSpeed: number | null; stoppedSince: string | null } | null;
  /**
   * Their privacy bubble. For other people it replaces `location` (which is
   * then null) with a general area; on your own entry it's your active bubble.
   */
  bubble?: MemberBubble | null;
}

/** A privacy bubble: a general area shown instead of an exact location. */
export interface Bubble {
  id: string;
  /** Centre of the area (deliberately not where the person is). */
  lat: number;
  lon: number;
  radiusM: number;
  /** Town or district name, when the server can look it up. */
  label: string | null;
  startedAt: string;
  endsAt: string;
}

export interface MemberBubble extends Bubble {
  battery?: number | null;
  charging?: boolean | null;
  /** When their phone last checked in. */
  seenAt?: string | null;
}

export interface Circle {
  id: string;
  name: string;
  color: string;
  role: CircleRole;
  memberCount: number;
  sharing: boolean;
  settings: CircleSettings;
  createdAt: string;
}

export interface CircleSettings {
  historyVisible: boolean;
  tripsVisible: boolean;
  membersCanInvite: boolean;
  /** Members may hide in a bubble (on unless an owner/admin turns it off). */
  bubblesAllowed: boolean;
}

export interface TripSummary {
  id: string;
  userId: string;
  status: 'in_progress' | 'completed';
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  distanceM: number;
  maxSpeed: number | null;
  avgMovingSpeed: number | null;
  avgSpeed: number | null;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startLabel: string | null;
  endLabel: string | null;
  stopCount: number;
  lowConfidence: boolean;
  /** For drives: whether the person was driving or a passenger (null = driver, as detected). */
  role?: 'driver' | 'passenger' | null;
  /** The person changed whether this was a drive or a walk. */
  modeEdited?: boolean;
}

export interface Place {
  id: string;
  ownerId: string;
  circleId: string | null;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  icon: string;
  color: string;
  address: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface MapStyleOption {
  id: string;
  name: string;
  url: string;
  dark: boolean;
}

export interface PublicConfig {
  instanceName: string;
  version: string;
  registrationPolicy: RegistrationPolicy;
  needsSetup: boolean;
  mapStyles: MapStyleOption[];
  geocoding: boolean;
  webPushPublicKey: string | null;
  passkeys: boolean;
  /** Domain passkeys belong to (the host of PUBLIC_URL). */
  passkeyRpId?: string;
  emailEnabled: boolean;
  defaultRetentionDays: number | null;
  /** Driving reports: speed counted as speeding. */
  driving?: { speedingKmh: number };
}

/**
 * Fixes from one upload, oldest first, sent along with a live location so
 * viewers can animate along the real path (phones upload in small batches).
 */
export interface TrailPoint {
  t: string;
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
}

/** Messages the server pushes over the realtime WebSocket. */
export type ServerEvent =
  | { type: 'hello'; userId: string }
  | { type: 'location'; userId: string; location: LocationFix; trail?: TrailPoint[] }
  | { type: 'sharing'; userId: string; circleId: string | null; sharing: boolean }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'trip'; userId: string; tripId: string; status: 'in_progress' | 'completed' }
  | { type: 'presence'; userId: string; placeId: string; inside: boolean }
  | { type: 'circle'; circleId: string }
  | { type: 'profile'; userId: string }
  | { type: 'bubble'; userId: string };
