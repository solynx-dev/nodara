import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, LocateFixed, Smartphone } from 'lucide-react';
import type { Me } from '@nodara/shared';
import { api } from '@/lib/api';
import { ago, coords } from '@/lib/format';
import { useCircles, useUser } from '@/lib/queries';
import { Badge, Button, cx, Switch } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useTracking } from './TrackingProvider';
import { isStandalone } from '@/lib/sw';

export function SharingPanel() {
  const t = useTracking();
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: circles } = useCircles();

  const pause = useMutation({
    mutationFn: (paused: boolean) => api.post<Me>('/api/me/sharing', { paused }),
    onSuccess: (m) => {
      qc.setQueryData(['me'], m);
      qc.invalidateQueries({ queryKey: ['live'] });
      toast({ tone: 'success', title: m.sharingPaused ? 'Location sharing paused for all circles' : 'Location sharing resumed' });
    },
  });
  const circleShare = useMutation({
    mutationFn: ({ id, sharing }: { id: string; sharing: boolean }) => api.patch(`/api/circles/${id}/me`, { sharing }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['circles'] });
      qc.invalidateQueries({ queryKey: ['live'] });
    },
  });
  const ios = /iPhone|iPad/.test(navigator.userAgent);

  return (
    <div className="space-y-5 pb-2">
      <div className="rounded-2xl border border-line bg-surface-2/50 p-4">
        <div className="flex items-start gap-3">
          <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', t.enabled ? 'bg-success/12 text-success' : 'bg-surface-3 text-muted')}>
            <Smartphone className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <Switch
              checked={t.enabled}
              onChange={(v) => (v ? void t.enable() : t.disable())}
              disabled={!t.supported}
              label="Share from this device"
              description={t.supported ? 'Sends your location while Nodara is open.' : 'This browser does not support location.'}
            />
          </div>
        </div>
        {t.enabled && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
            <div className="rounded-xl bg-surface p-2.5">
              <div className="eyebrow">Last fix</div>
              <div className="mt-0.5 font-semibold">{t.lastFix ? ago(new Date(t.lastFix.at).toISOString()) : 'Waiting…'}</div>
              {t.lastFix && <div className="tnum text-[11.5px] text-muted">±{Math.round(t.lastFix.accuracy ?? 0)} m · {coords(t.lastFix.lat, t.lastFix.lon)}</div>}
            </div>
            <div className="rounded-xl bg-surface p-2.5">
              <div className="eyebrow">Last sent</div>
              <div className="mt-0.5 font-semibold">{t.lastSentAt ? ago(new Date(t.lastSentAt).toISOString()) : '—'}</div>
              <div className="text-[11.5px] text-muted">{t.pending ? `${t.pending} queued` : `Every ~${t.intervalSec}s`}</div>
            </div>
          </div>
        )}
        {t.error && <p className="mt-3 text-[13px] text-danger">{t.error}</p>}
        {t.enabled && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="subtle" icon={<LocateFixed className="size-4" />} onClick={t.sendNow}>
              Update now
            </Button>
            {t.wakeLockSupported && (
              <Button size="sm" variant={t.wakeLock ? 'primary' : 'subtle'} onClick={() => t.setWakeLock(!t.wakeLock)}>
                {t.wakeLock ? 'Keeping screen awake' : 'Keep screen awake'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3 rounded-2xl bg-info/8 p-3.5 text-[13px] leading-relaxed text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-info" />
        <div>
          <b className="text-ink">Background tracking is limited in browsers.</b>{' '}
          {ios
            ? 'On iPhone, Safari stops sharing location when Nodara is not on screen. '
            : 'Browsers pause location updates when the app is in the background or the screen is off. '}
          {!isStandalone() && 'Installing Nodara to your Home Screen helps it reopen quickly. '}
          For continuous background sharing today, connect{' '}
          <Link to="/settings/devices" className="font-semibold text-accent-text">
            OwnTracks or Overland
          </Link>{' '}
          — they use the same Nodara API.
        </div>
      </div>

      <div>
        <Switch
          checked={!me.sharingPaused}
          onChange={(v) => pause.mutate(!v)}
          disabled={pause.isPending}
          label="Share my location with circles"
          description="Pausing hides your live location from everyone immediately, on every device."
        />
      </div>

      {circles && circles.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Per circle</div>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {circles.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3.5 py-3">
                <span className="size-2.5 rounded-full" style={{ background: c.color }} />
                <span className="flex-1 truncate text-[14px] font-semibold">{c.name}</span>
                {me.sharingPaused && <Badge tone="warning">Paused</Badge>}
                <Switch checked={c.sharing} onChange={(v) => circleShare.mutate({ id: c.id, sharing: v })} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Turning sharing back on for a circle starts a new visible window — the gap stays private.</p>
        </div>
      )}
    </div>
  );
}
