import type { Sql } from '../db/index.js';

/**
 * Central authorization queries. Every endpoint that exposes another user's
 * data must go through one of these functions — never trust a user id or circle
 * id from the request on its own.
 *
 * Rules:
 *  - You can always see your own data.
 *  - You can see another user's *live* location only if you share at least one
 *    circle where they have sharing enabled and they have not paused sharing.
 *  - You can see another user's *history / trips* only from the moment they
 *    started sharing with a common circle (`sharing_since`), only if that
 *    circle allows it, and only points recorded while their sharing was on.
 */

export async function isCircleMember(sql: Sql, circleId: string, userId: string) {
  const rows = await sql<{ role: string }[]>`
    SELECT role FROM circle_members WHERE circle_id = ${circleId} AND user_id = ${userId}`;
  return rows[0]?.role ?? null;
}

/** Users whose live location `viewerId` may see (including themself). */
export async function visibleUserIds(sql: Sql, viewerId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT t.user_id
    FROM circle_members me
    JOIN circle_members t ON t.circle_id = me.circle_id
    JOIN users u ON u.id = t.user_id
    WHERE me.user_id = ${viewerId} AND t.sharing AND NOT u.sharing_paused AND u.disabled_at IS NULL`;
  const ids = new Set(rows.map((r) => r.user_id));
  ids.add(viewerId);
  return [...ids];
}

/** Users who may see `userId`'s live location (including themself). */
export async function viewersOf(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT v.user_id
    FROM circle_members t
    JOIN circle_members v ON v.circle_id = t.circle_id
    JOIN users u ON u.id = t.user_id
    WHERE t.user_id = ${userId} AND t.sharing AND NOT u.sharing_paused`;
  const ids = new Set(rows.map((r) => r.user_id));
  ids.add(userId);
  return [...ids];
}

/** Users who share any circle with `userId` regardless of sharing state. */
export async function circleMatesOf(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT v.user_id FROM circle_members t
    JOIN circle_members v ON v.circle_id = t.circle_id
    WHERE t.user_id = ${userId} AND v.user_id <> ${userId}`;
  return rows.map((r) => r.user_id);
}

export async function canSeeLive(sql: Sql, viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return true;
  const rows = await sql`
    SELECT 1 FROM circle_members me
    JOIN circle_members t ON t.circle_id = me.circle_id
    JOIN users u ON u.id = t.user_id
    WHERE me.user_id = ${viewerId} AND t.user_id = ${targetId} AND t.sharing AND NOT u.sharing_paused
    LIMIT 1`;
  return rows.length > 0;
}

/**
 * `bubbles`: the viewer sees this person only through circles that allow
 * bubbles, so time the person spent in a bubble stays hidden from them.
 */
export type HistoryAccess = { own: true } | { own: false; since: Date; userId: string; bubbles: boolean } | null;

/**
 * Tolerance for device clocks running slightly behind the server, so the first
 * fix sent right after joining isn't hidden. Applies to live and history alike.
 */
export const CLOCK_SKEW_GRACE_MS = 2 * 60_000;

/**
 * Determine whether `viewerId` may read `targetId`'s history (or trips), and
 * from which moment. Returns null when access is denied.
 */
export async function historyAccess(
  sql: Sql,
  viewerId: string,
  targetId: string,
  kind: 'history' | 'trips' = 'history',
): Promise<HistoryAccess> {
  if (viewerId === targetId) return { own: true };
  const key = kind === 'history' ? 'historyVisible' : 'tripsVisible';
  const rows = await sql<{ since: Date | null; bubbles: boolean | null }[]>`
    SELECT min(t.sharing_since) AS since, bool_and(${bubblesAllowedSql(sql, 'c')}) AS bubbles
    FROM circle_members me
    JOIN circle_members t ON t.circle_id = me.circle_id
    JOIN circles c ON c.id = me.circle_id
    WHERE me.user_id = ${viewerId} AND t.user_id = ${targetId} AND t.sharing
      AND COALESCE((c.settings ->> ${key})::boolean, true)`;
  const since = rows[0]?.since;
  return since ? { own: false, since: new Date(since.getTime() - CLOCK_SKEW_GRACE_MS), userId: targetId, bubbles: rows[0]!.bubbles !== false } : null;
}

type Fragment = ReturnType<Sql>;

/** Circle setting check, written once: bubbles are allowed unless turned off. */
export const bubblesAllowedSql = (sql: Sql, alias: string) => sql`COALESCE((${sql(alias)}.settings ->> 'bubblesAllowed')::boolean, true)`;

/** SQL condition: `timestamp` (an expression) falls inside one of `userIdExpr`'s bubbles. */
export const inBubbleSql = (sql: Sql, userIdExpr: Fragment, timestamp: ReturnType<Sql>) => sql`EXISTS (
  SELECT 1 FROM bubbles b WHERE b.user_id = ${userIdExpr}
    AND ${timestamp} >= b.started_at AND ${timestamp} < COALESCE(b.ended_at, b.expires_at))`;

/** SQL condition: a span [start, end) overlaps one of `userId`'s bubbles. */
export const overlapsBubbleSql = (sql: Sql, userIdExpr: Fragment, start: Fragment, end: ReturnType<Sql>) => sql`EXISTS (
  SELECT 1 FROM bubbles b WHERE b.user_id = ${userIdExpr}
    AND ${start} < COALESCE(b.ended_at, b.expires_at) AND COALESCE(${end}, now()) > b.started_at)`;

/** SQL filter: a person's location rows (in `table`) that the viewer may see. */
export function locationsVisibleSql(sql: Sql, access: Exclude<HistoryAccess, null>, table = 'locations'): Fragment {
  if (access.own) return sql``;
  const t = sql(table);
  return sql`AND ${t}.shared AND ${t}.recorded_at >= ${access.since}
    ${access.bubbles ? sql`AND NOT ${inBubbleSql(sql, sql`${access.userId}::uuid`, sql`${t}.recorded_at`)}` : sql``}`;
}

/** SQL filter: a person's trips (in `table`) that the viewer may see. */
export function tripsVisibleSql(sql: Sql, access: Exclude<HistoryAccess, null>, table = 'trips'): Fragment {
  if (access.own) return sql``;
  const t = sql(table);
  return sql`AND ${t}.started_at >= ${access.since}
    ${access.bubbles ? sql`AND NOT ${overlapsBubbleSql(sql, sql`${access.userId}::uuid`, sql`${t}.started_at`, sql`${t}.ended_at`)}` : sql``}`;
}
