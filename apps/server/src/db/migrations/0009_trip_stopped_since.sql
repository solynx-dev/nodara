-- For an in-progress trip: since when the person has been standing still
-- (null while moving). Lets the apps show 0 km/h at a red light and hide the
-- speed once they've clearly parked.
ALTER TABLE trips ADD COLUMN stopped_since timestamptz;
