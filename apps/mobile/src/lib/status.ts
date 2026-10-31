import type { SFSymbol } from 'expo-symbols';
import { ago, clock, firstName, formatDuration, formatSpeed, freshness, type Units } from './format';
import { HEX } from './theme';
import type { MemberLocation, PlaceEvent } from './types';

export interface MemberStatus {
  /** Where they are, in words: "At Home", "Near 12 King St", "Location sharing off". */
  where: string;
  /** Short state pill: "Live", "Driving · 54 km/h", "Updated 2 h ago". */
  pill: { text: string; color: string; icon: SFSymbol };
  /** Extra line: "Since 7:32 PM · 3 h". */
  since: string | null;
  live: boolean;
  stale: boolean;
}

const MOVING = 1.5; // m/s

export function describeMember(m: MemberLocation, ev: PlaceEvent | undefined, address: string | null | undefined, units: Units): MemberStatus {
  const loc = m.location;
  if (!loc) {
    return m.sharing
      ? { where: 'Waiting for a first location', pill: { text: 'No location yet', color: HEX.gray, icon: 'location.slash' }, since: null, live: false, stale: false }
      : { where: 'Not sharing their location', pill: { text: 'Sharing off', color: HEX.gray, icon: 'eye.slash.fill' }, since: null, live: false, stale: false };
  }
  const f = freshness(loc.recordedAt);
  const live = f === 'live';
  const stale = f === 'stale' || f === 'old';
  const speed = loc.speed ?? 0;

  const where = m.currentPlace ? `At ${m.currentPlace.name}` : address ? `Near ${address}` : 'Address unavailable';

  let pill: MemberStatus['pill'];
  if (live && speed > MOVING) {
    const mode = speed > 7 ? 'Driving' : speed > 2.5 ? 'Moving' : 'Walking';
    const icon: SFSymbol = speed > 7 ? 'car.fill' : speed > 2.5 ? 'bicycle' : 'figure.walk';
    pill = { text: `${mode} · ${formatSpeed(speed, units)}`, color: HEX.blue, icon };
  } else if (m.inTrip && !stale) {
    pill = { text: 'On a trip', color: HEX.blue, icon: 'car.fill' };
  } else if (live) {
    pill = { text: 'Live', color: HEX.green, icon: 'dot.radiowaves.left.and.right' };
  } else if (f === 'recent') {
    pill = { text: `Updated ${ago(loc.recordedAt)}`, color: HEX.green, icon: 'clock' };
  } else if (f === 'stale') {
    pill = { text: `Updated ${ago(loc.recordedAt)}`, color: HEX.orange, icon: 'clock.badge.exclamationmark' };
  } else {
    pill = { text: `Last seen ${ago(loc.recordedAt)}`, color: HEX.gray, icon: 'moon.zzz.fill' };
  }

  let since: string | null = null;
  if (m.currentPlace && ev?.kind === 'arrive' && ev.place.id === m.currentPlace.id) {
    const mins = (Date.now() - Date.parse(ev.occurredAt)) / 1000;
    since = `Since ${clock(ev.occurredAt)} · ${formatDuration(mins).replace(/ \d+ s$/, '')}`;
  } else if (!m.currentPlace && ev?.kind === 'depart' && Date.now() - Date.parse(ev.occurredAt) < 6 * 3600_000) {
    since = `Left ${ev.place.name} ${ago(ev.occurredAt)}`;
  }
  return { where, pill, since, live, stale };
}

/** One-line summary of a circle: "2 at home · 1 driving · 1 not updated". */
export function circleSummary(members: MemberLocation[]): string {
  let atPlaces = 0;
  let moving = 0;
  let outdated = 0;
  let off = 0;
  for (const m of members) {
    const l = m.location;
    if (!l) {
      off++;
      continue;
    }
    const f = freshness(l.recordedAt);
    if (f === 'stale' || f === 'old') outdated++;
    else if ((l.speed ?? 0) > MOVING || m.inTrip) moving++;
    else if (m.currentPlace) atPlaces++;
  }
  const parts = [
    atPlaces && `${atPlaces} at a saved place`,
    moving && `${moving} on the move`,
    outdated && `${outdated} not updated recently`,
    off && `${off} not sharing`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `${members.length} ${members.length === 1 ? 'person' : 'people'}`;
}

export const nameOrYou = (m: { id: string; displayName: string }, meId: string) => (m.id === meId ? 'You' : firstName(m.displayName));
