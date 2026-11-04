import { BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, ChevronRight } from 'lucide-react';
import type { MemberLocation } from '@/lib/types';
import { ago, coords, formatSpeed, freshness } from '@/lib/format';
import { useUser } from '@/lib/queries';
import { Avatar, cx, StatusPill } from '@/components/ui';
import { describeMember } from '@/lib/status';
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
  if (!loc && m.bubble) return m.bubble.label ? `In a bubble around ${m.bubble.label}` : 'In a bubble';
  if (!m.sharing && !loc) return 'Not sharing location';
  if (!loc) return 'No location yet';
  if (m.currentPlace) return `At ${m.currentPlace.name}`;
  if (address) return address;
  return coords(loc.lat, loc.lon);
}

/** A person, like the iOS People list: photo with battery, where they are, how long, and a status pill. */
export function MemberRow({ member, onClick, selected, variant = 'row' }: { member: MemberLocation; onClick?: () => void; selected?: boolean; variant?: 'row' | 'card' }) {
  const me = useUser();
  const loc = member.location;
  const { data: address } = useAddress(member.currentPlace ? undefined : loc?.lat, member.currentPlace ? undefined : loc?.lon);
  const s = describeMember(member, address, me.preferences.units);
  const battery = loc?.battery ?? member.bubble?.battery ?? null;
  const charging = loc?.charging ?? member.bubble?.charging ?? null;
  const card = variant === 'card';
  const size = card ? 64 : 50;
  return (
    <button
      onClick={onClick}
      className={cx(
        'group flex w-full items-center gap-4 text-left transition',
        card ? 'card px-4 py-4 hover:bg-surface-2/40' : 'rounded-[22px] px-3 py-2.5 hover:bg-surface-2',
        selected && 'ring-2 ring-accent',
      )}
    >
      <div className="relative shrink-0 pb-1.5">
        <Avatar name={member.displayName} color={member.avatarColor} url={member.avatarUrl} size={size} dim={!loc && !member.bubble ? true : s.stale} />
        {battery != null && (
          <span
            className={cx(
              'tnum absolute -bottom-0.5 left-1/2 flex h-[22px] -translate-x-1/2 items-center gap-1 rounded-full border-[2.5px] border-surface bg-surface px-1.5 text-[11.5px] font-bold whitespace-nowrap',
              battery <= 15 && !charging ? 'text-danger' : 'text-ink',
            )}
          >
            <BatteryIcon level={battery} charging={charging} />
            {battery}%
          </span>
        )}
        {member.currentPlace && (
          <span className="absolute -top-0.5 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-surface text-white" style={{ background: member.currentPlace.color }}>
            <PlaceIcon name={member.currentPlace.icon} className="size-3" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cx('truncate font-bold', card ? 'text-[19px]' : 'text-[17px]')}>{member.id === me.id ? 'You' : member.displayName}</span>
          {s.live && <span className="size-2.5 shrink-0 rounded-full bg-success shadow-[0_0_0_4px_color-mix(in_srgb,var(--success)_18%,transparent)]" />}
        </div>
        <div className={cx('truncate', card ? 'text-[16px]' : 'text-[15px]')}>{s.where}</div>
        {s.stayFor && <div className="truncate text-[14px] text-muted">Here for {s.stayFor}</div>}
        <StatusPill tone={s.pill.tone} icon={<s.pill.icon />} className="mt-1.5">
          {s.pill.text}
        </StatusPill>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted/60" />
    </button>
  );
}

function BatteryIcon({ level, charging }: { level: number; charging: boolean | null }) {
  const Icon = charging ? BatteryCharging : level <= 15 ? BatteryLow : level <= 60 ? BatteryMedium : BatteryFull;
  return <Icon className="size-3.5" />;
}
