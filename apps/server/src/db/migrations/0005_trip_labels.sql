-- When place names for a trip were last looked up, so the background job that
-- names older trips (after a geocoder is added) tries each trip only once.
ALTER TABLE trips ADD COLUMN labelled_at timestamptz;
CREATE INDEX trips_unlabelled_idx ON trips (started_at DESC)
  WHERE status = 'completed' AND labelled_at IS NULL AND (start_label IS NULL OR end_label IS NULL);
