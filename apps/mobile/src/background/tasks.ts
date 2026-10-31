import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { enqueueAndFlush, toFixes } from './upload';

export const LOCATION_TASK = 'nodara-location-updates';
export const GEOFENCE_TASK = 'nodara-geofences';

// iOS delivers batched locations here, also after relaunching Nodara in the background.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await enqueueAndFlush(await toFixes(data.locations));
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
