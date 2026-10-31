import { BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, Car, EyeOff } from 'lucide-react';
import type { MemberLocation } from '@/lib/types';
import { ago, coords, formatSpeed, freshness } from '@/lib/format';
import { useUser } from '@/lib/queries';
import { Avatar, cx } from '@/components/ui';
import { PlaceIcon } from '@/features/map/icons';
import { useAddress } from './hooks';

export function BatteryIndicator({ level, charging, className }: { level: number | null; charging: boolean | null; className?: string }) {
  if (level == null) return null;
  const Icon = charging ? BatteryCharging : level <= 15 ? BatteryLow : level <= 60 ? BatteryMedium : BatteryFull;
  return (
    <span className={cx('tnum inline-flex items-center gap-1 text-[12px] font-semibold', level <= 15 && !charging ? 'text-danger' : 'text-muted', className)}>
      <Icon className="size-3.5" />
      {level}%
    </span>
  );
}

export function FreshDot({ iso }: { iso: string | null | undefined }) {
  const f = freshness(iso);
  const color = { live: 'bg-success', recent: 'bg-success/60', stale: 'bg-warning', old: 'bg-muted/50' }[f];
  return <span className={cx('inline-block size-2 shrink-0 rounded-full', color)} />;
}

/** One-line description of where someone is. Never presents stale data as live. */
export function useWhereLabel(m: MemberLocation) {
  const loc = m.location;
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  if (!m.sharing && !loc) return 'Not sharing location';
  if (!loc) return 'No location yet';
  if (m.currentPlace) return `At ${m.currentPlace.name}`;
  if (address) return address;
  return coords(loc.lat, loc.lon);
}

export function MemberRow({ member, onClick, selected }: { member: MemberLocation; onClick?: () => void; selected?: boolean }) {
  const me = useUser();
  const where = useWhereLabel(member);
  const loc = member.location;
  const f = freshness(loc?.recordedAt);
  const moving = loc && (loc.speed ?? 0) > 1.5 && f === 'live';
  return (
    <button
      onClick={onClick}
      className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition', selected ? 'bg-accent-soft' : 'hover:bg-surface-2')}
    >
      <div className="relative">
        <Avatar name={member.displayName} color={member.avatarColor} size={42} dim={!loc || f === 'old'} />
        {member.currentPlace && (
          <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-surface text-white" style={{ background: member.currentPlace.color }}>
            <PlaceIcon name={member.currentPlace.icon} className="size-2.5" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-bold">{member.id === me.id ? `${member.displayName} (you)` : member.displayName}</span>
          {member.inTrip && <Car className="size-3.5 shrink-0 text-accent" />}
        </div>
        <div className="flex items-center gap-1.5 text-[13px] text-muted">
          {!member.sharing && !loc ? <EyeOff className="size-3.5" /> : <FreshDot iso={loc?.recordedAt} />}
          <span className="truncate">{where}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {loc && <span className={cx('text-[12px] font-semibold', f === 'stale' || f === 'old' ? 'text-warning' : 'text-muted')}>{f === 'live' ? (moving ? formatSpeed(loc.speed, me.preferences.units) : 'Now') : ago(loc.recordedAt)}</span>}
        <BatteryIndicator level={loc?.battery ?? null} charging={loc?.charging ?? null} />
      </div>
    </button>
  );
}
