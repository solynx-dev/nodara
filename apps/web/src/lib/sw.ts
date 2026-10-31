import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useToast } from '@/components/toast';

/** Registers the service worker and offers updates without interrupting the user. */
export function useServiceWorker() {
  const toast = useToast();
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    const update = registerSW({
      onNeedRefresh() {
        toast({ tone: 'info', title: 'A new version of Nodara is available', action: { label: 'Reload now', onClick: () => void update(true) } });
      },
    });
  }, [toast]);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
