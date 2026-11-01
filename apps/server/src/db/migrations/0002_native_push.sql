-- Native app push tokens (Expo push service → APNs/FCM).
ALTER TABLE devices ADD COLUMN expo_push_token text;
