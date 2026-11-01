import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { enqueueAndFlush, toFixes } from '@/background/upload';
import { notePhoneUse } from '@/background/phoneUse';
import { getItem, KEYS } from '@/lib/storage';
import { LOCATION_TASK } from '@/background/tasks';

/**
 * While Nodara is on screen, also watch the position directly and flush the
 * offline queue. This keeps the map live in Expo Go (where background tasks
 * aren't available) and sends a fresh fix every time the app is opened.
 */
export function ForegroundReporter() {
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    const start = async () => {
      if (!(await getItem(KEYS.tracking))) return;
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted' || cancelled) return;
      void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then(async (p) => enqueueAndFlush(await toFixes([p])))
        .catch(() => {});
      const backgroundRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
      if (backgroundRunning || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 25, timeInterval: 15_000 },
        (p) => void toFixes([p]).then(enqueueAndFlush),
      );
    };

    void start();
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        // Opening Nodara counts as phone use if you turn out to be moving (driving reports).
        void notePhoneUse();
        sub?.remove();
        sub = null;
        void start();
        void enqueueAndFlush([]);
      }
    });
    return () => {
      cancelled = true;
      sub?.remove();
      appSub.remove();
    };
  }, []);
  return null;
}
