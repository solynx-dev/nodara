import { haversine } from '@nodara/shared';
import type { Ctx } from '../context.js';
import { evaluateFence } from './geofence-eval.js';
import { canSeeLive } from './access.js';

export interface FenceFix {
  t: Date;
  lat: number;
  lon: number;
  accuracy: number | null;
}

/** Events older than this (e.g. uploaded from an offline queue) are recorded but not announced. */
const NOTIFY_MAX_AGE_MS = 30 * 60_000;

/**
 * Evaluate a user's newly ingested fixes against every place they are subject
 * to: places in circles where they currently share their location, plus their
 * own private places. Emits arrive/depart events with hysteresis, a per-place
 * cooldown against flapping, and notifies subscribers.
 */
export async function evaluateGeofences(ctx: Ctx, userId: string, fixes: FenceFix[]) {
  if (fixes.length === 0) return [];
  const { sql } = ctx;
  const places = await sql<
    { id: string; name: string; lat: number; lon: number; radius_m: number; circle_id: string | null; icon: string; color: string }[]
  >`
    SELECT p.id, p.name, p.lat, p.lon, p.radius_m, p.circle_id, p.icon, p.color FROM places p
    WHERE (p.circle_id IS NULL AND p.owner_id = ${userId})
       OR p.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = ${userId} AND sharing)`;
  if (places.length === 0) return [];

  const presenceRows = await sql<{ place_id: string; inside: boolean; changed_at: Date; last_event_at: Date | null }[]>`
    SELECT place_id, inside, changed_at, last_event_at FROM place_presence WHERE user_id = ${userId}`;
  const presence = new Map(presenceRows.map((r) => [r.place_id, { ...r }]));
  const { geofenceCooldownSec } = await ctx.settings.get();
  const [user] = await sql<{ display_name: string; is_demo: boolean }[]>`SELECT display_name, is_demo FROM users WHERE id = ${userId}`;
  const events: { placeId: string; kind: 'arrive' | 'depart'; at: Date }[] = [];
  const dirty = new Set<string>();

  for (const fix of fixes) {
    for (const place of places) {
      const prev = presence.get(place.id);
      if (prev && fix.t <= prev.changed_at) continue; // out-of-order fix
      const dist = haversine(fix.lat, fix.lon, place.lat, place.lon);
      const r = evaluateFence(prev ? prev.inside : null, dist, place.radius_m, fix.accuracy);
      if (r.inside === null || (prev && r.inside === prev.inside)) continue;

      const cooled = !prev?.last_event_at || fix.t.getTime() - prev.last_event_at.getTime() > geofenceCooldownSec * 1000;
      presence.set(place.id, {
        place_id: place.id,
        inside: r.inside,
        changed_at: fix.t,
        last_event_at: r.event ? fix.t : prev?.last_event_at ?? null,
      });
      dirty.add(place.id);
      if (!r.event) continue;

      await sql`INSERT INTO place_events (place_id, user_id, kind, occurred_at, is_demo)
                VALUES (${place.id}, ${userId}, ${r.event}, ${fix.t}, ${user?.is_demo ?? false})`;
      events.push({ placeId: place.id, kind: r.event, at: fix.t });
      ctx.hub.publish([userId], { type: 'presence', userId, placeId: place.id, inside: r.inside });

      const fresh = Date.now() - fix.t.getTime() < NOTIFY_MAX_AGE_MS;
      if (!fresh || !cooled || !place.circle_id) continue;
      await notifySubscribers(ctx, place, userId, user?.display_name ?? 'Someone', r.event, fix.t);
    }
  }

  for (const id of dirty) {
    const p = presence.get(id)!;
    await sql`
      INSERT INTO place_presence (place_id, user_id, inside, changed_at, last_event_at)
      VALUES (${id}, ${userId}, ${p.inside}, ${p.changed_at}, ${p.last_event_at})
      ON CONFLICT (place_id, user_id) DO UPDATE
        SET inside = EXCLUDED.inside, changed_at = EXCLUDED.changed_at, last_event_at = EXCLUDED.last_event_at`;
  }
  // Circle-mates see presence changes on their live map.
  return events;
}

async function notifySubscribers(
  ctx: Ctx,
  place: { id: string; name: string; circle_id: string | null },
  userId: string,
  displayName: string,
  kind: 'arrive' | 'depart',
  at: Date,
) {
  const subs = await ctx.sql<{ subscriber_id: string }[]>`
    SELECT DISTINCT a.subscriber_id FROM place_alerts a
    JOIN circle_members m ON m.circle_id = ${place.circle_id} AND m.user_id = a.subscriber_id
    WHERE a.place_id = ${place.id}
      AND (a.member_id IS NULL OR a.member_id = ${userId})
      AND a.subscriber_id <> ${userId}
      AND ${kind === 'arrive' ? ctx.sql`a.on_arrive` : ctx.sql`a.on_depart`}
      AND NOT COALESCE((m.notify_settings ->> 'muted')::boolean, false)
      -- Never announce movements from before the member started sharing with this circle.
      AND EXISTS (SELECT 1 FROM circle_members t WHERE t.circle_id = ${place.circle_id} AND t.user_id = ${userId}
                  AND t.sharing AND t.sharing_since <= ${at})`;
  for (const s of subs) {
    if (!(await canSeeLive(ctx.sql, s.subscriber_id, userId))) continue;
    const verb = kind === 'arrive' ? 'arrived at' : 'left';
    await ctx.notify.notify({
      userId: s.subscriber_id,
      type: kind === 'arrive' ? 'arrival' : 'departure',
      title: `${displayName} ${verb} ${place.name}`,
      data: { userId, placeId: place.id, kind, at: at.toISOString() },
      dedupeKey: `place:${place.id}:${userId}:${kind}`,
      dedupeWindowSec: 120,
      url: `/map?member=${userId}`,
    });
  }
}
