import { describe, expect, it } from 'vitest';
import { bearing, circlePolygon, compassDirection, haversine } from './geo';

describe('geo', () => {
  it('computes great-circle distances', () => {
    // Halifax → Toronto ≈ 1 264 km
    expect(haversine(44.6488, -63.5752, 43.6532, -79.3832) / 1000).toBeCloseTo(1264, 0);
    expect(haversine(1, 1, 1, 1)).toBe(0);
  });
  it('computes bearings and compass directions', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0);
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90);
    expect(compassDirection(359)).toBe('N');
    expect(compassDirection(135)).toBe('SE');
  });
  it('builds closed circle polygons of the right radius', () => {
    const ring = circlePolygon(44.65, -63.58, 150, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const [lon, lat] of ring) expect(haversine(44.65, -63.58, lat, lon)).toBeCloseTo(150, 0);
  });
});
