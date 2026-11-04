import type { LucideIcon } from 'lucide-react';
import { Bike, Car, CircleDashed, Clock, EyeOff, Footprints, MapPinOff, Moon, Radio, TriangleAlert } from 'lucide-react';
import type { UnitSystem } from '@nodara/shared';
import type { MemberLocation } from './types';
import { ago, clock, formatSpeed, freshness } from './format';
import type { Tone } from '@/components/ui';

/**
 * How a person is described everywhere, matching the iOS app: where they are,
 * a coloured status pill, and how long they've been there.
 */
export interface MemberStatus {
  where: string;
  pill: { text: string; tone: Tone; icon: LucideIcon };
  /** "Here for 3 h 12 min". */
  stayFor: string | null;
  live: boolean;
  stale: boolean;
}

const MOVING = 1.5; // m/s
const RED_KMH = 130;

export function stayText(sec: number) {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

export function stayDuration(m: MemberLocation): string | null {
  if (!m.stay || m.inTrip) return null;
  const sec = (Date.now() - Date.parse(m.stay.since)) / 1000;
  if (sec < 60) return null;
  return `${m.stay.atLeast ? 'at least ' : ''}${stayText(sec)}`;
}

export function describeMember(m: MemberLocation, address: string | null | undefined, units: UnitSystem): MemberStatus {
  const loc = m.location;
  if (!loc && m.bubble) {
    return {
      where: m.bubble.label ? `Somewhere around ${m.bubble.label}` : 'In a bubble',
      pill: { text: `Bubble until ${clock(m.bubble.endsAt)}`, tone: 'bubble', icon: CircleDashed },
      stayFor: null,
      live: false,
      stale: false,
    };
  }
  if (!loc) {
    return m.sharing
      ? { where: 'Waiting for a first location', pill: { text: 'No location yet', tone: 'neutral', icon: MapPinOff }, stayFor: null, live: false, stale: false }
      : { where: 'Not sharing their location', pill: { text: 'Sharing off', tone: 'neutral', icon: EyeOff }, stayFor: null, live: false, stale: false };
  }
  const f = freshness(loc.recordedAt);
  const live = f === 'live';
  const stale = f === 'stale' || f === 'old';
  const speed = loc.speed ?? 0;
  const where = m.currentPlace ? `At ${m.currentPlace.name}` : (address ?? 'Address unavailable');

  let pill: MemberStatus['pill'];
  if (live && speed > MOVING) {
    const tooFast = speed * 3.6 >= RED_KMH;
    const [mode, icon] = speed > 7 ? (['Driving', Car] as const) : speed > 2.5 ? (['Moving', Bike] as const) : (['Walking', Footprints] as const);
    pill = { text: `${mode} · ${formatSpeed(speed, units)}`, tone: tooFast ? 'danger' : 'info', icon: tooFast ? TriangleAlert : icon };
  } else if (m.inTrip && !stale) pill = { text: 'On a trip', tone: 'info', icon: Car };
  else if (live) pill = { text: 'Live', tone: 'success', icon: Radio };
  else if (f === 'recent') pill = { text: `Updated ${ago(loc.recordedAt)}`, tone: 'success', icon: Clock };
  else if (f === 'stale') pill = { text: `Updated ${ago(loc.recordedAt)}`, tone: 'warning', icon: Clock };
  else pill = { text: `Last seen ${ago(loc.recordedAt)}`, tone: 'neutral', icon: Moon };

  return { where, pill, stayFor: stayDuration(m), live, stale };
}

/** "1 at a saved place · 1 on the move · 1 not sharing". */
export function circleSummary(members: MemberLocation[]): string {
  let atPlaces = 0;
  let moving = 0;
  let outdated = 0;
  let off = 0;
  let bubbles = 0;
  for (const m of members) {
    const l = m.location;
    if (!l) {
      if (m.bubble) bubbles++;
      else off++;
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
    bubbles && `${bubbles} in a bubble`,
    outdated && `${outdated} not updated recently`,
    off && `${off} not sharing`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `${members.length} ${members.length === 1 ? 'person' : 'people'}`;
}
