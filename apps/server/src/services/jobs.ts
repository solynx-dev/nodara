import type { Ctx } from '../context.js';
import { processDeviceTrips } from './trips.js';

/**
 * Retention: deletes location history older than the effective retention
 * period. The per-user setting wins over the server default. Nothing is ever
 * removed silently: users are notified when history is removed, the policy is
 * shown in Settings and History, and every run is written to the audit log.
 */
export async function runRetention(ctx: Ctx, opts: { dryRun?: boolean } = {}) {
  const { sql } = ctx;
  const { defaultRetentionDays } = await ctx.settings.get();
  const users = await sql<{ id: string; days: number | null }[]>`
    SELECT id, COALESCE((preferences ->> 'retentionDays')::int, ${defaultRetentionDays || null}::int) AS days FROM users`;
  const results: { userId: string; days: number; locations: number; trips: number }[] = [];
  for (const u of users) {
    if (!u.days || u.days <= 0) continue;
    const cutoff = new Date(Date.now() - u.days * 86_400_000);
    if (opts.dryRun) {
      const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM locations WHERE user_id = ${u.id} AND recorded_at < ${cutoff}`;
      const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM trips WHERE user_id = ${u.id} AND started_at < ${cutoff}`;
      if (r!.n || t!.n) results.push({ userId: u.id, days: u.days, locations: r!.n, trips: t!.n });
      continue;
    }
    const loc = await sql`DELETE FROM locations WHERE user_id = ${u.id} AND recorded_at < ${cutoff}`;
    await sql`DELETE FROM driving_events WHERE user_id = ${u.id} AND started_at < ${cutoff}`;
    const trips = await sql`DELETE FROM trips WHERE user_id = ${u.id} AND started_at < ${cutoff} AND status = 'completed'`;
    await sql`DELETE FROM place_events WHERE user_id = ${u.id} AND occurred_at < ${cutoff}`;
    if (loc.count || trips.count) {
      results.push({ userId: u.id, days: u.days, locations: loc.count, trips: trips.count });
      await ctx.notify.notify({
        userId: u.id,
        type: 'retention',
        title: 'Old location history was removed',
        body: `${loc.count.toLocaleString()} location points and ${trips.count} trips older than ${u.days} days were deleted per your retention setting.`,
        dedupeKey: 'retention',
        dedupeWindowSec: 20 * 3600,
        url: '/settings/privacy',
      });
    }
  }
  if (!opts.dryRun && results.length) {
    await sql`INSERT INTO audit_log (action, details) VALUES ('retention.run', ${sql.json({ results } as never)})`;
  }
  return results;
}

/** Warn people (and opted-in circle-mates) when a device stops reporting. */
export async function checkOfflineDevices(ctx: Ctx) {
  const { sql } = ctx;
  const { offlineAfterMinutes } = await ctx.settings.get();
  const stale = await sql<{ id: string; user_id: string; name: string; display_name: string; last_location_at: Date }[]>`
    UPDATE devices d SET offline_notified_at = now()
    FROM users u
    WHERE u.id = d.user_id AND d.revoked_at IS NULL AND NOT u.sharing_paused AND NOT u.is_demo
      AND d.last_location_at IS NOT NULL
      AND d.last_location_at < now() - make_interval(mins => ${offlineAfterMinutes})
      AND d.last_location_at > now() - interval '7 days'
      AND (d.offline_notified_at IS NULL OR d.offline_notified_at < d.last_location_at)
    RETURNING d.id, d.user_id, d.name, u.display_name, d.last_location_at`;
  for (const d of stale) {
    // Only notify about the user's most recently active device.
    const [latest] = await sql<{ id: string }[]>`
      SELECT id FROM devices WHERE user_id = ${d.user_id} AND revoked_at IS NULL ORDER BY last_location_at DESC NULLS LAST LIMIT 1`;
    if (latest?.id !== d.id) continue;
    await ctx.notify.notify({
      userId: d.user_id,
      type: 'device_offline',
      title: `${d.name} stopped sharing location`,
      body: 'No update received recently. If you use the web app, keep it open — browsers pause location in the background.',
      data: { deviceId: d.id },
      dedupeKey: `offline:${d.id}`,
      dedupeWindowSec: 6 * 3600,
      url: '/settings/devices',
    });
    const mates = await sql<{ user_id: string; notify_settings: Record<string, unknown> }[]>`
      SELECT DISTINCT ON (v.user_id) v.user_id, v.notify_settings FROM circle_members t
      JOIN circle_members v ON v.circle_id = t.circle_id
      WHERE t.user_id = ${d.user_id} AND t.sharing AND v.user_id <> ${d.user_id}`;
    for (const m of mates) {
      if (m.notify_settings.muted) continue;
      await ctx.notify.notify({
        userId: m.user_id,
        type: 'device_offline',
        title: `${d.display_name}'s location is out of date`,
        body: `Last update ${Math.round((Date.now() - d.last_location_at.getTime()) / 60_000)} minutes ago.`,
        data: { userId: d.user_id },
        dedupeKey: `offline:${d.id}`,
        dedupeWindowSec: 6 * 3600,
        url: `/map?member=${d.user_id}`,
      });
    }
  }
  return stale.length;
}

/** Close trips whose device went silent mid-trip. */
export async function closeIdleTrips(ctx: Ctx) {
  const rows = await ctx.sql<{ device_id: string }[]>`
    SELECT device_id FROM trips WHERE status = 'in_progress' AND device_id IS NOT NULL`;
  for (const r of rows) await processDeviceTrips(ctx, r.device_id);
}

export async function cleanupExpired(ctx: Ctx) {
  const { sql } = ctx;
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  await sql`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'`;
  await sql`DELETE FROM webauthn_challenges WHERE expires_at < now()`;
  await sql`DELETE FROM invitations WHERE expires_at < now() - interval '30 days'`;
  await sql`DELETE FROM ingest_stats WHERE hour < now() - interval '90 days'`;
}

/** Exactly what would be sent if an administrator enables anonymous telemetry. */
export async function telemetryPayload(ctx: Ctx) {
  const [r] = await ctx.sql<{ users: number; circles: number; devices: number }[]>`
    SELECT (SELECT count(*)::int FROM users WHERE NOT is_demo) AS users,
           (SELECT count(*)::int FROM circles WHERE NOT is_demo) AS circles,
           (SELECT count(*)::int FROM devices WHERE revoked_at IS NULL) AS devices`;
  const bucket = (n: number) => (n <= 5 ? '1-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '100+');
  return {
    schema: 1,
    version: process.env.npm_package_version ?? '0.1.0',
    node: process.versions.node.split('.')[0],
    users: bucket(r!.users),
    circles: bucket(r!.circles),
    devices: bucket(r!.devices),
  };
}

export async function sendTelemetry(ctx: Ctx) {
  const s = await ctx.settings.get();
  if (!s.telemetryEnabled || !ctx.config.TELEMETRY_ENDPOINT) return false;
  try {
    await fetch(ctx.config.TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await telemetryPayload(ctx)),
      signal: AbortSignal.timeout(10_000),
    });
    return true;
  } catch {
    return false;
  }
}

export function startJobs(ctx: Ctx) {
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        ctx.log.error({ err }, `job ${name} failed`);
      } finally {
        running = false;
      }
    };
    timers.push(setInterval(run, ms));
    setTimeout(run, 10_000).unref();
  };
  every(60_000, 'close-idle-trips', () => closeIdleTrips(ctx));
  every(5 * 60_000, 'offline-devices', () => checkOfflineDevices(ctx));
  every(6 * 3600_000, 'retention', () => runRetention(ctx));
  every(3600_000, 'cleanup', () => cleanupExpired(ctx));
  every(7 * 86_400_000, 'telemetry', () => sendTelemetry(ctx));
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
