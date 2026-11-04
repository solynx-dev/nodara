-- People can correct their own trips: a drive or a walk, and for drives,
-- whether they were driving or a passenger. Passenger drives and walks don't
-- count towards driving reports. NULL means "as detected" / "the driver".
ALTER TABLE trips ADD COLUMN mode_override text CHECK (mode_override IN ('driving', 'walking'));
ALTER TABLE trips ADD COLUMN role text CHECK (role IN ('driver', 'passenger'));
