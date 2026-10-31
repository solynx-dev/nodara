import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { haversine, type Me } from '@nodara/shared';
import { api, ApiError } from '@/lib/api';
import { deviceLabel } from '@/lib/format';
import type { Device } from '@/lib/types';

/**
 * Foreground location sharing for the browser / installed PWA.
 *
 * Honest limits: browsers only deliver positions while the page is running.
 * On iOS that means while Nodara is open on screen; Android Chrome may keep
 * going briefly in the background. We never claim otherwise in the UI.
 * Native apps (and OwnTracks/Overland today) use the same ingestion API for
 * reliable background tracking.
 */

export type TrackingStatus = 'off' | 'starting' | 'active' | 'background' | 'paused' | 'error';

interface Fix {
  recordedAt: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery: number | null;
  charging: boolean | null;
}

export interface TrackingState {
  supported: boolean;
  enabled: boolean;
  status: TrackingStatus;
  permission: PermissionState | 'unknown';
  deviceId: string | null;
  lastFix: { lat: number; lon: number; accuracy: number | null; at: number; speed: number | null } | null;
  lastSentAt: number | null;
  pending: number;
  error: string | null;
  wakeLock: boolean;
  wakeLockSupported: boolean;
  intervalSec: number;
}

interface TrackingApi extends TrackingState {
  enable: () => Promise<void>;
  disable: () => void;
  sendNow: () => void;
  setWakeLock: (on: boolean) => void;
}

const TrackingCtx = createContext<TrackingApi | null>(null);
export const useTracking = () => {
  const v = useContext(TrackingCtx);
  if (!v) throw new Error('useTracking outside provider');
  return v;
};

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const MAX_QUEUE = 2000;

export function TrackingProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const keys = useMemo(
    () => ({ enabled: `nodara.tracking.${me.id}`, device: `nodara.device.${me.id}`, queue: `nodara.queue.${me.id}`, wake: 'nodara.wakelock' }),
    [me.id],
  );
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [state, setState] = useState<TrackingState>(() => ({
    supported,
    enabled: store.get(keys.enabled, false),
    status: 'off',
    permission: 'unknown',
    deviceId: store.get<string | null>(keys.device, null),
    lastFix: null,
    lastSentAt: null,
    pending: store.get<Fix[]>(keys.queue, []).length,
    error: null,
    wakeLock: store.get(keys.wake, false),
    wakeLockSupported,
    intervalSec: me.preferences.updateIntervalSec,
  }));
  const patch = useCallback((p: Partial<TrackingState>) => setState((s) => ({ ...s, ...p })), []);

  const queue = useRef<Fix[]>(store.get<Fix[]>(keys.queue, []));
  const lastSent = useRef<{ t: number; lat: number; lon: number } | null>(null);
  const lastPositionAt = useRef(0);
  const flushing = useRef(false);
  const deviceId = useRef<string | null>(state.deviceId);
  const prefs = useRef(me.preferences);
  prefs.current = me.preferences;
  const paused = me.sharingPaused;

  // -- Permission tracking ------------------------------------------------------
  useEffect(() => {
    if (!navigator.permissions) return;
    let status: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        patch({ permission: s.state });
        s.onchange = () => patch({ permission: s.state });
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, [patch]);

  // -- Device registration --------------------------------------------------------
  const ensureDevice = useCallback(async () => {
    const devices = await api.get<Device[]>('/api/devices');
    if (deviceId.current && devices.some((d) => d.id === deviceId.current)) return deviceId.current;
    const { device } = await api.post<{ device: Device }>('/api/devices', { name: deviceLabel(), kind: 'web' });
    deviceId.current = device.id;
    store.set(keys.device, device.id);
    patch({ deviceId: device.id });
    qc.invalidateQueries({ queryKey: ['devices'] });
    return device.id;
  }, [keys.device, patch, qc]);

  // -- Upload queue -----------------------------------------------------------------
  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0 || !deviceId.current) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const batch = queue.current.slice(0, 200);
        await api.post('/api/locations', { deviceId: deviceId.current, locations: batch });
        queue.current = queue.current.slice(batch.length);
        store.set(keys.queue, queue.current);
        patch({ lastSentAt: Date.now(), pending: queue.current.length, error: null });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Device was revoked elsewhere: register again on the next fix.
        deviceId.current = null;
        store.set(keys.device, null);
        void ensureDevice().catch(() => {});
      }
      if (e instanceof ApiError && e.status === 400) {
        // Malformed data will never succeed; drop it rather than retrying forever.
        queue.current = [];
        store.set(keys.queue, []);
      }
      patch({ pending: queue.current.length, error: e instanceof ApiError && e.status === 0 ? 'Offline — updates are queued and will be sent when you reconnect.' : null });
    } finally {
      flushing.current = false;
    }
  }, [ensureDevice, keys.queue, patch]);

  const battery = useRef<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }> };
    nav.getBattery?.().then((b) => {
      const update = () => (battery.current = { level: b.level, charging: b.charging });
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => {});
  }, []);

  // -- Position handling --------------------------------------------------------------
  const onPosition = useCallback(
    (pos: GeolocationPosition, force = false) => {
      lastPositionAt.current = Date.now();
      const c = pos.coords;
      const now = pos.timestamp || Date.now();
      patch({ lastFix: { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, at: now, speed: c.speed }, status: document.hidden ? 'background' : 'active', error: null });

      const p = prefs.current;
      const prev = lastSent.current;
      const moved = prev ? haversine(prev.lat, prev.lon, c.latitude, c.longitude) : Infinity;
      const moving = (c.speed ?? 0) > 1.5 || (prev != null && moved > 60 && now - prev.t < 120_000);
      const base = p.updateIntervalSec;
      const interval = p.adaptiveInterval ? (moving ? Math.max(5, Math.min(base, 15)) : Math.max(base, 60)) : base;
      patch({ intervalSec: interval });
      const due = !prev || now - prev.t >= interval * 1000 || (moved > 250 && now - prev.t >= 5000);
      if (!force && !due) return;

      lastSent.current = { t: now, lat: c.latitude, lon: c.longitude };
      queue.current.push({
        recordedAt: new Date(now).toISOString(),
        lat: c.latitude,
        lon: c.longitude,
        accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
        altitude: c.altitude,
        altitudeAccuracy: c.altitudeAccuracy,
        speed: c.speed != null && c.speed >= 0 ? c.speed : null,
        heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : null,
        battery: battery.current ? Math.round(battery.current.level * 100) : null,
        charging: battery.current?.charging ?? null,
      });
      if (queue.current.length > MAX_QUEUE) queue.current = queue.current.slice(-MAX_QUEUE);
      store.set(keys.queue, queue.current);
      patch({ pending: queue.current.length });
      void flush();
    },
    [flush, keys.queue, patch],
  );

  const onError = useCallback(
    (err: GeolocationPositionError) => {
      const messages: Record<number, string> = {
        1: 'Location permission was denied. Allow location access for this site in your browser settings.',
        2: "Your device couldn't determine its position. Make sure location services are on.",
        3: 'Getting your position timed out. Nodara will keep trying.',
      };
      patch({ error: messages[err.code] ?? err.message, status: err.code === 1 ? 'error' : state.status, permission: err.code === 1 ? 'denied' : state.permission });
    },
    [patch, state.status, state.permission],
  );

  // -- Watch lifecycle -----------------------------------------------------------------
  const active = state.enabled && supported && !paused;
  useEffect(() => {
    if (!active) {
      patch({ status: paused && state.enabled ? 'paused' : 'off' });
      return;
    }
    let cancelled = false;
    let watchId: number | null = null;
    patch({ status: 'starting' });
    const geoOpts = { enableHighAccuracy: me.preferences.highAccuracy, maximumAge: 5000, timeout: 30_000 };

    ensureDevice()
      .then(() => {
        if (cancelled) return;
        watchId = navigator.geolocation.watchPosition((p) => onPosition(p), onError, geoOpts);
        void flush();
      })
      .catch((e) => patch({ status: 'error', error: e instanceof Error ? e.message : 'Could not register this device' }));

    // Heartbeat: some browsers only call watchPosition on movement. Ask
    // explicitly so circle-mates keep seeing a fresh location.
    const heartbeat = window.setInterval(() => {
      if (document.hidden) return;
      const p = prefs.current;
      const interval = Math.max(p.updateIntervalSec, p.adaptiveInterval ? 60 : 0) * 1000;
      if (Date.now() - lastPositionAt.current >= interval) {
        navigator.geolocation.getCurrentPosition((pos) => onPosition(pos, true), onError, { ...geoOpts, maximumAge: interval });
      } else if (lastSent.current && Date.now() - lastSent.current.t >= interval) {
        navigator.geolocation.getCurrentPosition((pos) => onPosition(pos, true), () => {}, { ...geoOpts, maximumAge: 15_000 });
      }
    }, 15_000);

    const onVisibility = () => {
      if (document.hidden) {
        patch({ status: 'background' });
      } else {
        patch({ status: 'active' });
        navigator.geolocation.getCurrentPosition((pos) => onPosition(pos, true), onError, { ...geoOpts, maximumAge: 10_000 });
      }
    };
    const onOnline = () => void flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, me.preferences.highAccuracy]);

  // -- Screen wake lock (keeps the app in the foreground while tracking) ----------------
  useEffect(() => {
    if (!active || !state.wakeLock || !wakeLockSupported) return;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then((s) => (sentinel = s)).catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [active, state.wakeLock, wakeLockSupported]);

  const enable = useCallback(async () => {
    if (!supported) return;
    // Request permission explicitly from the user gesture.
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          patch({ permission: 'granted' });
          store.set(keys.enabled, true);
          patch({ enabled: true });
          lastSent.current = null;
          setTimeout(() => onPosition(pos, true), 300);
          resolve();
        },
        (err) => {
          onError(err);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 20_000 },
      );
    });
  }, [keys.enabled, onError, onPosition, patch, supported]);

  const disable = useCallback(() => {
    store.set(keys.enabled, false);
    patch({ enabled: false, status: 'off' });
  }, [keys.enabled, patch]);

  const sendNow = useCallback(() => {
    navigator.geolocation.getCurrentPosition((pos) => onPosition(pos, true), onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
  }, [onError, onPosition]);

  const setWakeLock = useCallback(
    (on: boolean) => {
      store.set(keys.wake, on);
      patch({ wakeLock: on });
    },
    [keys.wake, patch],
  );

  const value = useMemo(() => ({ ...state, enable, disable, sendNow, setWakeLock }), [state, enable, disable, sendNow, setWakeLock]);
  return <TrackingCtx.Provider value={value}>{children}</TrackingCtx.Provider>;
}
