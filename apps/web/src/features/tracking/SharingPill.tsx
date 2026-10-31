import { useState } from 'react';
import { Navigation, NavigationOff, Pause } from 'lucide-react';
import { useUser } from '@/lib/queries';
import { cx, Dialog } from '@/components/ui';
import { useTracking } from './TrackingProvider';
import { SharingPanel } from './SharingPanel';

/** Always-visible location-sharing status for this device. */
export function SharingPill({ compact }: { compact?: boolean }) {
  const t = useTracking();
  const me = useUser();
  const [open, setOpen] = useState(false);

  const state = me.sharingPaused
    ? { label: 'Sharing paused', tone: 'warning', icon: Pause }
    : !t.enabled
      ? { label: 'Not sharing from this device', tone: 'muted', icon: NavigationOff }
      : t.status === 'error'
        ? { label: 'Location unavailable', tone: 'danger', icon: NavigationOff }
        : t.status === 'background'
          ? { label: 'Paused in background', tone: 'warning', icon: Navigation }
          : { label: 'Sharing live', tone: 'success', icon: Navigation };
  const tones: Record<string, string> = {
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/12',
    danger: 'text-danger bg-danger/10',
    muted: 'text-muted bg-surface-2',
  };
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cx(
          'flex items-center gap-2 rounded-xl text-left font-semibold transition hover:brightness-110',
          tones[state.tone],
          compact ? 'h-9 px-2.5 text-[12px]' : 'w-full px-3 py-2.5 text-[13px]',
        )}
      >
        <span className="relative flex size-4 items-center justify-center">
          {state.tone === 'success' && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-success/50" />}
          <state.icon className="relative size-4" />
        </span>
        {compact ? <span className="hidden sm:inline">{state.label}</span> : <span className="flex-1">{state.label}</span>}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Location sharing" description="Control what this device shares and with whom.">
        <SharingPanel />
      </Dialog>
    </>
  );
}
