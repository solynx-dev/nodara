-- Silent location refresh. The app registers a push token used only to wake it
-- in the background for one fresh fix (no banner, sound or badge), separate from
-- the notification token so it works even when notifications are off.
ALTER TABLE devices ADD COLUMN wake_token text;
ALTER TABLE devices ADD COLUMN wake_requested_at timestamptz;
