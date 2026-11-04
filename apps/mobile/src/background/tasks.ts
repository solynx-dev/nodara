import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { enqueueAndFlush, toFixes } from './upload';
import { adaptToMotion } from './motion';
import * as Notifications from 'expo-notifications';
import { isWake, sendFreshLocation } from './wake';

export const LOCATION_TASK = 'nodara-location-updates';
export const GEOFENCE_TASK = 'nodara-geofences';
export const WAKE_TASK = 'nodara-wake';

// iOS delivers batched locations here, also after relaunching Nodara in the background.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await enqueueAndFlush(await toFixes(data.locations));
  // Stay chatty while on the move (so a stop shows as 0 km/h), quiet once parked.
  await adaptToMotion(data.locations).catch(() => {});
});

// Region monitoring wakes Nodara even if it was terminated. The server decides
// arrivals/departures from coordinates, so we just send a fresh fix right away.
TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await enqueueAndFlush(await toFixes([pos]));
  } catch {
    const last = await Location.getLastKnownPositionAsync();
    if (last) await enqueueAndFlush(await toFixes([last]));
  }
});

// A silent push from the server (someone tapped refresh, or this phone has been
// quiet for an hour) wakes Nodara for a few seconds to send one fresh fix.
// iOS runs this task for every push, so anything that isn't ours is ignored.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(WAKE_TASK, async ({ data, error }) => {
  if (error || !data || 'actionIdentifier' in data || !isWake(data.data ?? data)) return Notifications.BackgroundNotificationTaskResult.NoData;
  const sent = await sendFreshLocation().catch(() => false);
  return sent ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
});
Notifications.registerTaskAsync(WAKE_TASK).catch(() => {});
