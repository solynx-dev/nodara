import { Link } from 'react-router';
import { Bike, Car, Footprints, HelpCircle, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import type { Trip } from '@/lib/types';
import { clock, coords, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { useUser } from '@/lib/queries';
import { Avatar, Badge, cx } from '@/components/ui';

export const MODE_META = {
  driving: { icon: Car, label: 'Drive' },
  cycling: { icon: Bike, label: 'Ride' },
  walking: { icon: Footprints, label: 'Walk' },
  unknown: { icon: HelpCircle, label: 'Trip' },
} as const;

export function tripTitle(t: Trip) {
  const s = t.startLabel ?? coords(t.startLat, t.startLon);
  const e = t.status === 'in_progress' ? 'now' : (t.endLabel ?? coords(t.endLat, t.endLon));
  return { from: s, to: e };
}

export function TripRow({ trip, person, compact }: { trip: Trip; person?: { displayName: string; avatarColor: string; avatarUrl?: string | null }; compact?: boolean }) {
  const me = useUser();
  const Mode = MODE_META[trip.mode].icon;
  const { from, to } = tripTitle(trip);
  return (
    <Link to={`/trips/${trip.id}`} className="group flex items-center gap-3.5 rounded-2xl px-3 py-3 transition hover:bg-surface-2">
      <div className="relative">
        <div className={cx('flex size-11 items-center justify-center rounded-xl', trip.status === 'in_progress' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2')}>
          <Mode className="size-5" />
        </div>
        {person && (
          <div className="absolute -right-1.5 -bottom-1.5">
            <Avatar name={person.displayName} color={person.avatarColor} url={person.avatarUrl} size={20} className="ring-2 ring-surface" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14.5px] font-bold">
          <span className="truncate">{from}</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted" />
          <span className="truncate">{to}</span>
        </div>
        <div className="tnum mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
          <span>{compact ? clock(trip.startedAt) : format(new Date(trip.startedAt), 'EEE MMM d · h:mm a')}</span>
          <span>·</span>
          <span>{formatDistance(trip.distanceM, me.preferences.units)}</span>
          <span>·</span>
          <span>{formatDuration(trip.durationSec)}</span>
          {!compact && trip.maxSpeed != null && (
            <>
              <span>·</span>
              <span>max {formatSpeed(trip.maxSpeed, me.preferences.units)}</span>
            </>
          )}
        </div>
      </div>
      {trip.status === 'in_progress' ? <Badge tone="accent">Live</Badge> : trip.lowConfidence ? <Badge>Low accuracy</Badge> : null}
    </Link>
  );
}
