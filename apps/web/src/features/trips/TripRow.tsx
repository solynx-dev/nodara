import { Link } from 'react-router';
import { Bike, Car, ChevronRight, Footprints, HelpCircle } from 'lucide-react';
import type { Trip } from '@/lib/types';
import { clock, coords, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { useUser } from '@/lib/queries';
import { Avatar, cx } from '@/components/ui';

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

/**
 * One drive, laid out like the iOS app: where it started (green) and ended
 * (red) with their times, and distance · duration · top speed in between.
 * `card` stands on its own; `row` sits inside another card.
 */
export function TripRow({
  trip,
  person,
  variant = 'card',
}: {
  trip: Trip;
  person?: { displayName: string; avatarColor: string; avatarUrl?: string | null };
  variant?: 'card' | 'row';
  /** @deprecated kept for older call sites */
  compact?: boolean;
}) {
  const me = useUser();
  const units = me.preferences.units;
  const Mode = MODE_META[trip.mode].icon;
  const { from, to } = tripTitle(trip);
  const live = trip.status === 'in_progress';
  return (
    <Link
      to={`/trips/${trip.id}`}
      className={cx(
        'group flex items-center gap-3 transition',
        variant === 'card' ? 'card px-5 py-4 hover:bg-surface-2/40' : 'rounded-[20px] px-3 py-3 hover:bg-surface-2',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="size-3 shrink-0 rounded-full bg-success" />
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{from}</span>
          <span className="tnum shrink-0 text-[15px] text-muted">{clock(trip.startedAt)}</span>
        </div>
        <div className="flex items-stretch gap-3">
          <span className="flex w-3 shrink-0 justify-center">
            <span className="my-1 w-px bg-line-strong" />
          </span>
          <div className="tnum flex min-w-0 flex-1 items-center gap-2 py-2 text-[14px] text-muted">
            <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', live ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2')}>
              <Mode className="size-4" />
            </span>
            {person && <Avatar name={person.displayName} color={person.avatarColor} url={person.avatarUrl} size={22} />}
            <span className="truncate">
              {formatDistance(trip.distanceM, units)} · {formatDuration(trip.durationSec)}
              {trip.maxSpeed != null && trip.maxSpeed > 1 && ` · top ${formatSpeed(trip.maxSpeed, units)}`}
              {trip.lowConfidence && ' · low GPS quality'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cx('size-3 shrink-0 rounded-full', live ? 'animate-pulse bg-accent' : 'bg-danger')} />
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{live ? 'On the way' : to}</span>
          <span className="tnum shrink-0 text-[15px] text-muted">{live ? 'Now' : trip.endedAt ? clock(trip.endedAt) : ''}</span>
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted/60 transition group-hover:translate-x-0.5" />
    </Link>
  );
}
