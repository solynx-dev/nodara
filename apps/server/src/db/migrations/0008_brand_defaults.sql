-- New brand: default colours for people, circles and places move from orange to
-- Nodara purple. Existing colours (which people may have picked) are left alone.
ALTER TABLE users ALTER COLUMN avatar_color SET DEFAULT '#6D3EF5';
ALTER TABLE circles ALTER COLUMN color SET DEFAULT '#6D3EF5';
ALTER TABLE places ALTER COLUMN color SET DEFAULT '#6D3EF5';
