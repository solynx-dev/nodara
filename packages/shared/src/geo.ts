/** Mean Earth radius in metres (IUGG). */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two WGS84 coordinates, in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, in degrees clockwise from north (0–360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function compassDirection(deg: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** Approximate a circle as a GeoJSON polygon ring (for drawing geofences / accuracy). */
export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  const angular = radiusM / EARTH_RADIUS_M;
  const latR = toRad(lat);
  const lonR = toRad(lon);
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(angular) + Math.cos(latR) * Math.sin(angular) * Math.cos(brng),
    );
    const lon2 =
      lonR +
      Math.atan2(
        Math.sin(brng) * Math.sin(angular) * Math.cos(latR),
        Math.cos(angular) - Math.sin(latR) * Math.sin(lat2),
      );
    coords.push([toDeg(lon2), toDeg(lat2)]);
  }
  return coords;
}
