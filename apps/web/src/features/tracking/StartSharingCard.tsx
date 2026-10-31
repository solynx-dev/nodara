import { MapPinned, Navigation } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useTracking } from './TrackingProvider';

/** Permission onboarding: explains what will happen before the browser prompt. */
export function StartSharingCard() {
  const t = useTracking();
  if (t.enabled || !t.supported) return null;
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-accent/15 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_8px_24px_-8px_var(--accent)]">
          <MapPinned className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-bold tracking-tight">Share your location from this device</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            Your browser will ask for permission. Nodara sends your position to <b className="text-ink-2">your own server</b> while the app is open, and only circles you choose can see it.
            {t.permission === 'denied' && <span className="mt-1 block font-semibold text-danger">Location is blocked for this site — allow it in your browser settings first.</span>}
          </p>
        </div>
        <Button variant="primary" size="lg" icon={<Navigation className="size-4" />} onClick={() => void t.enable()}>
          Start sharing
        </Button>
      </div>
    </Card>
  );
}
