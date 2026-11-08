import type { Ctx } from '../context.js';
import type { HistoryAccess } from './access.js';
import { drivingEvents } from '../modules/driving.js';

/** Roughly how many points a card's route preview gets. */
const PREVIEW_POINTS = 100;

/**
 * Adds what a trip card needs to draw its little map: a simplified route
 * (`preview`, [lat, lon] pairs, at most ~100 points) and how many driving
 * events happened on it (`eventCount`), counted with the same rules and
 * visibility as the driving report.
 */
export async function withPreviews<T extends { id: string; startedAt: string; endedAt: string | null; startLat: number; startLon: number; endLat: number; endLon: number }>(
  ctx: Ctx,
  userId: string,
  access: Exclude<HistoryAccess, null>,
  trips: T[],
): Promise<(T & { preview: [number, number][]; eventCount: number })[]> {
  if (!trips.length) return [];
  const ids = trips.map((t) => t.id);
  const rows = await ctx.sql<{ id: string; g: string | null }[]>`
    SELECT id, ST_AsGeoJSON(ST_SimplifyPreserveTopology(route::geometry, GREATEST(0.00003, ST_Length(route::geometry) / ${PREVIEW_POINTS})), 5) AS g
    FROM trips WHERE id = ANY(${ids}::uuid[])`;
  const routes = new Map(rows.map((r) => [r.id, r.g ? (JSON.parse(r.g) as { coordinates?: [number, number][] }).coordinates ?? [] : []]));

  const from = new Date(Math.min(...trips.map((t) => Date.parse(t.startedAt))));
  const to = new Date(Math.max(...trips.map((t) => (t.endedAt ? Date.parse(t.endedAt) : Date.now()))) + 1000);
  const events = await drivingEvents(ctx, userId, access, from, to, 5000);
  const counts = new Map<string, number>();
  for (const e of events) if (e.tripId) counts.set(e.tripId, (counts.get(e.tripId) ?? 0) + 1);

  return trips.map((t) => {
    const route = routes.get(t.id) ?? [];
    const preview: [number, number][] = route.length > 1 ? route.map(([lon, lat]) => [lat, lon]) : [[t.startLat, t.startLon], [t.endLat, t.endLon]];
    return { ...t, preview, eventCount: counts.get(t.id) ?? 0 };
  });
}
