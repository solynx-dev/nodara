import type { Bubble } from '@nodara/shared';
import { haversine } from '@nodara/shared';
import type { Ctx } from '../context.js';
import type { Sql } from '../db/index.js';
import { bubblesAllowedSql, viewersOf } from './access.js';

/**
 * Bubbles: for a few hours, a person's circles see only a general area around
 * them, not their exact location. Circle owners and admins can turn bubbles off
 * for their circle; there, everyone keeps seeing the exact location.
 *
 * While a bubble is on, viewers who only see the person through circles that
 * allow bubbles get the area instead of the location, and no live updates,
 * place arrivals or trips. The time spent in a bubble stays hidden from those
 * viewers' history afterwards too.
 */

export interface BubbleRow {
  id: string;
  user_id: string;
  lat: number;
  lon: number;
  radius_m: number;
  label: string | null;
  started_at: Date;
  expires_at: Date;
}

export const BUBBLE_MIN_RADIUS_M = 500;
export const BUBBLE_MAX_RADIUS_M = 100_000;
export const BUBBLE_MAX_HOURS = 24;
/** Leaving the area by more than this (plus GPS accuracy) ends the bubble. */
const EXIT_MARGIN_M = 150;

export function serializeBubble(b: BubbleRow): Bubble {
  return {
    id: b.id,
    lat: b.lat,
    lon: b.lon,
    radiusM: b.radius_m,
    label: b.label,
    startedAt: b.started_at.toISOString(),
    endsAt: b.expires_at.toISOString(),
  };
}

export async function currentBubble(sql: Sql, userId: string): Promise<BubbleRow | null> {
  const [b] = await sql<BubbleRow[]>`
    SELECT id, user_id, lat, lon, radius_m, label, started_at, expires_at FROM bubbles
    WHERE user_id = ${userId} AND ended_at IS NULL AND expires_at > now()
    ORDER BY started_at DESC LIMIT 1`;
  return b ?? null;
}

/** Who still gets someone's exact location during their bubble: themself, and circles that turned bubbles off. */
export async function exactViewersOf(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT v.user_id FROM circle_members t
    JOIN circle_members v ON v.circle_id = t.circle_id
    JOIN circles c ON c.id = t.circle_id
    JOIN users u ON u.id = t.user_id
    WHERE t.user_id = ${userId} AND t.sharing AND NOT u.sharing_paused AND NOT ${bubblesAllowedSql(sql, 'c')}`;
  return [...new Set([userId, ...rows.map((r) => r.user_id)])];
}

/** Viewers for live updates (location, trips): everyone who may see them, narrowed while a bubble is on. */
export async function liveViewersOf(sql: Sql, userId: string): Promise<string[]> {
  return (await currentBubble(sql, userId)) ? exactViewersOf(sql, userId) : viewersOf(sql, userId);
}

/** Is this person's activity hidden from a circle right now (bubble on, and the circle allows bubbles)? */
export async function hiddenFromCircle(sql: Sql, userId: string, circleId: string): Promise<boolean> {
  const [r] = await sql<{ hidden: boolean }[]>`
    SELECT ${bubblesAllowedSql(sql, 'c')} AS hidden FROM circles c WHERE c.id = ${circleId}`;
  return Boolean(r?.hidden) && Boolean(await currentBubble(sql, userId));
}

/** The person's circles and whether each lets bubbles hide them. */
export async function bubbleCircles(sql: Sql, userId: string) {
  return sql<{ id: string; name: string; color: string; allowed: boolean; sharing: boolean }[]>`
    SELECT c.id, c.name, c.color, ${bubblesAllowedSql(sql, 'c')} AS allowed, m.sharing
    FROM circle_members m JOIN circles c ON c.id = m.circle_id
    WHERE m.user_id = ${userId} ORDER BY c.created_at`;
}

/** Somewhere within 40% of the radius from where they are, so the centre doesn't give them away. */
export function randomCentre(lat: number, lon: number, radiusM: number, rand: () => number = Math.random) {
  const d = 0.4 * radiusM * Math.sqrt(rand());
  const angle = 2 * Math.PI * rand();
  const dLat = (d * Math.cos(angle)) / 111_320;
  const dLon = (d * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

const nameOf = async (sql: Sql, userId: string) =>
  (await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`)[0]?.display_name ?? 'Someone';

/** Viewers who only see this person through circles that allow bubbles (they get the area). */
async function bubbleViewersOf(sql: Sql, userId: string) {
  const exact = new Set(await exactViewersOf(sql, userId));
  return (await viewersOf(sql, userId)).filter((v) => !exact.has(v));
}

const hoursText = (ms: number) => {
  const h = Math.round(ms / 3_600_000);
  return h <= 1 ? 'an hour' : `${h} hours`;
};

export async function startBubble(ctx: Ctx, userId: string, opts: { radiusM: number; hours: number; lat: number; lon: number }) {
  const { sql } = ctx;
  const centre = randomCentre(opts.lat, opts.lon, opts.radiusM);
  const label = await ctx.geocoder.area(centre.lat, centre.lon, opts.radiusM).catch(() => null);
  const row = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`bubble:${userId}`}))`;
    // A new bubble replaces the current one (to change its size or length).
    await tx`
      UPDATE bubbles SET ended_at = LEAST(now(), expires_at), end_reason = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'replaced' END
      WHERE user_id = ${userId} AND ended_at IS NULL`;
    const [b] = await tx<BubbleRow[]>`
      INSERT INTO bubbles (user_id, lat, lon, radius_m, label, expires_at)
      VALUES (${userId}, ${centre.lat}, ${centre.lon}, ${opts.radiusM}, ${label}, now() + make_interval(mins => ${Math.round(opts.hours * 60)}))
      RETURNING id, user_id, lat, lon, radius_m, label, started_at, expires_at`;
    return b!;
  });
  const name = await nameOf(sql, userId);
  for (const v of await bubbleViewersOf(sql, userId)) {
    await ctx.notify.notify({
      userId: v,
      type: 'bubble',
      title: `${name} started a bubble`,
      body: `You'll see ${label ? `that they're around ${label}` : 'their general area'} for the next ${hoursText(row.expires_at.getTime() - Date.now())}.`,
      data: { userId },
      dedupeKey: `bubble:${userId}`,
      dedupeWindowSec: 600,
      url: `/map?member=${userId}`,
    });
  }
  ctx.hub.publish(await viewersOf(sql, userId), { type: 'bubble', userId });
  return row;
}

/** End the current bubble: by hand, at its time, or because they left the area. */
export async function endBubble(ctx: Ctx, userId: string, reason: 'ended' | 'expired' | 'left_area') {
  const { sql } = ctx;
  // Who couldn't see them, captured before the bubble ends.
  const hiddenFrom = await bubbleViewersOf(sql, userId);
  const ended = await sql<{ id: string }[]>`
    UPDATE bubbles SET ended_at = LEAST(now(), expires_at), end_reason = ${reason}
    WHERE user_id = ${userId} AND ended_at IS NULL RETURNING id`;
  if (!ended.length) return false;
  const name = await nameOf(sql, userId);
  const why = reason === 'left_area' ? `${name} left their bubble's area` : `${name}'s bubble ended`;
  for (const v of hiddenFrom) {
    await ctx.notify.notify({
      userId: v,
      type: 'bubble',
      title: why,
      body: 'You can see their location again.',
      data: { userId },
      dedupeKey: `bubble:${userId}`,
      dedupeWindowSec: 600,
      url: `/map?member=${userId}`,
    });
  }
  if (reason !== 'ended') {
    await ctx.notify.notify({
      userId,
      type: 'bubble_ended',
      title: reason === 'left_area' ? 'You left your bubble' : 'Your bubble ended',
      body: 'Your circles can see your location again.',
      data: { reason },
      dedupeKey: `bubble-self:${userId}`,
      dedupeWindowSec: 60,
      url: '/map',
    });
  }
  ctx.hub.publish(await viewersOf(sql, userId), { type: 'bubble', userId });
  return true;
}

/** Background job: close bubbles whose time is up and tell everyone. */
export async function expireBubbles(ctx: Ctx) {
  const due = await ctx.sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id FROM bubbles WHERE ended_at IS NULL AND expires_at <= now()`;
  for (const d of due) await endBubble(ctx, d.user_id, 'expired');
  return due.length;
}

/** After new fixes arrive: leaving the area ends the bubble, so the area never misleads. */
export async function checkBubbleExit(ctx: Ctx, userId: string, fix: { lat: number; lon: number; accuracy: number | null; recorded_at: Date }) {
  const b = await currentBubble(ctx.sql, userId);
  if (!b || fix.recorded_at < b.started_at) return false;
  if ((fix.accuracy ?? 0) > 200) return false;
  const d = haversine(fix.lat, fix.lon, b.lat, b.lon);
  if (d <= b.radius_m + EXIT_MARGIN_M + (fix.accuracy ?? 0)) return false;
  return endBubble(ctx, userId, 'left_area');
}
