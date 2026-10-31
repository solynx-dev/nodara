import { describe, expect, it } from 'vitest';
import { freshness, initials } from './format';
import { formatDistance, formatDuration, formatSpeed } from '@nodara/shared';

describe('freshness', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('classifies location age so stale data is never shown as live', () => {
    expect(freshness(ago(30_000), now)).toBe('live');
    expect(freshness(ago(5 * 60_000), now)).toBe('recent');
    expect(freshness(ago(60 * 60_000), now)).toBe('stale');
    expect(freshness(ago(24 * 3600_000), now)).toBe('old');
    expect(freshness(null, now)).toBe('old');
  });
});

describe('formatting', () => {
  it('formats units', () => {
    expect(formatSpeed(10, 'metric')).toBe('36 km/h');
    expect(formatSpeed(10, 'imperial')).toBe('22 mph');
    expect(formatDistance(850, 'metric')).toBe('850 m');
    expect(formatDistance(12_345, 'metric')).toBe('12 km');
    expect(formatDistance(1609.344 * 2.5, 'imperial')).toBe('2.5 mi');
    expect(formatDuration(3725)).toBe('1 h 02 min');
  });
  it('builds initials', () => {
    expect(initials('Alex Rivera')).toBe('AR');
    expect(initials('Sam')).toBe('S');
  });
});
