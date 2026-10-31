import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';
import { ingestFixes, type FixInput } from '../services/ingest.js';
import { bearing, haversine } from '@nodara/shared';

/**
 * Demo data for development and screenshots.
 *
 * Everything created here is flagged `is_demo` and lives in a separate
 * "Demo — Rivera family" circle with @demo.nodara.ca accounts, so it never
 * mixes with real people's data. Remove it at any time from Admin → Demo data,
 * or with `--purge`.
 *
 *   pnpm seed:demo                     # create demo family with 14 days of history
 *   pnpm seed:demo --join you@x.com    # also add your account to the demo circle
 *   pnpm seed:demo --live              # then keep one member driving in real time (via the HTTP API)
 *   pnpm seed:demo --purge             # delete all demo data
 */
const { values } = parseArgs({
  // Tolerate the `--` separator added by `pnpm <script> -- …`.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    join: { type: 'string' },
    days: { type: 'string', default: '14' },
    live: { type: 'boolean', default: false },
    url: { type: 'string', default: 'http://localhost:8080' },
    purge: { type: 'boolean', default: false },
  },
});

type LL = [number, number];
// Halifax, Nova Scotia — a compact, recognisable grid.
const PLACES = {
  home: { name: 'Home', at: [44.6468, -63.5937] as LL, icon: 'home', color: '#FF7A45', radius: 120 },
  work: { name: 'Harbour Office', at: [44.6497, -63.5736] as LL, icon: 'work', color: '#4C9AFF', radius: 150 },
  school: { name: 'Citadel High', at: [44.6431, -63.5839] as LL, icon: 'school', color: '#36B37E', radius: 150 },
  gym: { name: 'Gym', at: [44.6578, -63.6127] as LL, icon: 'gym', color: '#B37FEB', radius: 100 },
  grandma: { name: "Nana's", at: [44.6712, -63.6359] as LL, icon: 'heart', color: '#F56A9A', radius: 120 },
  park: { name: 'Point Pleasant Park', at: [44.6262, -63.5675] as LL, icon: 'tree', color: '#13C2C2', radius: 400 },
};

const PEOPLE = [
  { key: 'alex', name: 'Alex Rivera', color: '#FF7A45', device: 'Pixel 9', routine: ['work', 'gym'] },
  { key: 'sam', name: 'Sam Rivera', color: '#4C9AFF', device: 'iPhone 16', routine: ['grandma', 'work'] },
  { key: 'maya', name: 'Maya Rivera', color: '#36B37E', device: 'iPhone SE', routine: ['school', 'park'] },
  { key: 'theo', name: 'Theo Rivera', color: '#F5A524', device: 'Galaxy A55', routine: ['school', 'gym'] },
] as const;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** A street-like path: axis-aligned legs with a couple of jogs, like driving a grid. */
function streetPath(a: LL, b: LL, rand: () => number): LL[] {
  const pts: LL[] = [a];
  const jogs = 1 + Math.floor(rand() * 2);
  let cur = a;
  for (let i = 1; i <= jogs; i++) {
    const f = i / (jogs + 1);
    const lat = a[0] + (b[0] - a[0]) * f + (rand() - 0.5) * 0.002;
    const next: LL = [lat, cur[1]];
    pts.push(next);
    const lon = a[1] + (b[1] - a[1]) * f + (rand() - 0.5) * 0.002;
    cur = [lat, lon];
    pts.push(cur);
  }
  pts.push([b[0], cur[1]], b);
  return pts;
}

/** Sample a path at `intervalSec`, with speed easing at corners. */
function drive(path: LL[], startMs: number, cruise: number, intervalSec: number, rand: () => number) {
  const fixes: FixInput[] = [];
  let t = startMs;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1]!, path[i]!];
    const len = haversine(a[0], a[1], b[0], b[1]);
    let d = 0;
    while (d < len) {
      const edge = Math.min(d, len - d);
      const v = Math.max(3, Math.min(cruise * (0.85 + rand() * 0.3), 4 + edge / 12));
      const f = d / len;
      fixes.push({
        recordedAt: t,
        lat: a[0] + (b[0] - a[0]) * f + (rand() - 0.5) * 0.00006,
        lon: a[1] + (b[1] - a[1]) * f + (rand() - 0.5) * 0.00006,
        accuracy: 5 + rand() * 8,
        speed: v,
        heading: bearing(a[0], a[1], b[0], b[1]),
        battery: null,
        charging: false,
      });
      d += v * intervalSec;
      t += intervalSec * 1000;
    }
  }
  return { fixes, end: t };
}

function dwell(at: LL, from: number, to: number, rand: () => number, intervalSec = 300) {
  const fixes: FixInput[] = [];
  for (let t = from; t < to; t += intervalSec * 1000) {
    fixes.push({
      recordedAt: t,
      lat: at[0] + (rand() - 0.5) * 0.0003,
      lon: at[1] + (rand() - 0.5) * 0.0003,
      accuracy: 8 + rand() * 25,
      speed: 0,
      heading: null,
      battery: null,
      charging: null,
    });
  }
  return fixes;
}

const config = loadConfig({ ...process.env, DISABLE_JOBS: 'true', LOG_LEVEL: 'warn' });
const { app, ctx } = await buildApp(config, { logger: false });
const { sql } = ctx;
await migrate(sql);

if (values.purge) {
  const users = await sql`DELETE FROM users WHERE is_demo RETURNING id`;
  await sql`DELETE FROM circles WHERE is_demo`;
  console.log(`Removed ${users.length} demo users and their data.`);
  await app.close();
  await sql.end();
  process.exit(0);
}

const existing = await sql`SELECT 1 FROM users WHERE is_demo LIMIT 1`;
if (existing.length && !values.live) {
  console.log('Demo data already exists. Run with --purge first to regenerate.');
  await app.close();
  await sql.end();
  process.exit(0);
}

const tokens: Record<string, string> = {};
if (!existing.length) {
  const password = await hashPassword(randomToken());
  const [circle] = await sql<{ id: string }[]>`
    INSERT INTO circles (name, color, is_demo, settings) VALUES ('Demo — Rivera family', '#FF7A45', true,
      ${sql.json({ historyVisible: true, tripsVisible: true, membersCanInvite: false })}) RETURNING id`;
  const ids: Record<string, { userId: string; deviceId: string }> = {};
  for (const [i, p] of PEOPLE.entries()) {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, password_hash, is_demo, avatar_color, email_verified_at)
      VALUES (${`${p.key}@demo.nodara.ca`}, ${p.name}, ${password}, true, ${p.color}, now()) RETURNING id`;
    const token = `ndd_${randomToken()}`;
    tokens[p.key] = token;
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO devices (user_id, name, kind, token_hash, token_hint)
      VALUES (${u!.id}, ${p.device}, ${p.device.startsWith('iPhone') ? 'ios' : 'android'}, ${sha256(token)}, ${token.slice(-4)}) RETURNING id`;
    await sql`INSERT INTO circle_members (circle_id, user_id, role, sharing_since)
              VALUES (${circle!.id}, ${u!.id}, ${i === 0 ? 'owner' : i === 1 ? 'admin' : 'member'}, now() - interval '60 days')`;
    ids[p.key] = { userId: u!.id, deviceId: d!.id };
  }
  const placeIds: Record<string, string> = {};
  for (const [key, pl] of Object.entries(PLACES)) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO places (owner_id, circle_id, name, lat, lon, radius_m, icon, color, is_demo)
      VALUES (${ids.alex!.userId}, ${circle!.id}, ${pl.name}, ${pl.at[0]}, ${pl.at[1]}, ${pl.radius}, ${pl.icon}, ${pl.color}, true)
      RETURNING id`;
    placeIds[key] = row!.id;
  }
  if (values.join) {
    const [real] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${values.join.toLowerCase()} AND NOT is_demo`;
    if (!real) console.warn(`No user ${values.join}; skipping --join`);
    else {
      await sql`INSERT INTO circle_members (circle_id, user_id, role) VALUES (${circle!.id}, ${real.id}, 'admin') ON CONFLICT DO NOTHING`;
      for (const key of ['home', 'school']) {
        await sql`INSERT INTO place_alerts (place_id, subscriber_id) VALUES (${placeIds[key]!}, ${real.id}) ON CONFLICT DO NOTHING`;
      }
      console.log(`Added ${values.join} to the demo circle.`);
    }
  }

  // Generate history day by day, in chronological order, through the real ingestion pipeline.
  const days = Number(values.days);
  const now = Date.now();
  const startDay = new Date();
  startDay.setHours(0, 0, 0, 0);
  for (const [pi, p] of PEOPLE.entries()) {
    const rand = rng(1000 + pi);
    let battery = 100;
    let fixes: FixInput[] = [];
    let cursor = startDay.getTime() - days * 86_400_000;
    for (let day = days; day >= 0; day--) {
      const dayStart = startDay.getTime() - day * 86_400_000;
      const weekend = [0, 6].includes(new Date(dayStart).getDay());
      const stops = weekend ? [p.routine[1], 'park'] : [...p.routine];
      let at: LL = PLACES.home.at;
      let t = dayStart + (7 + rand() * 1.5) * 3600_000 + pi * 600_000;
      fixes.push(...dwell(at, cursor, t, rand));
      for (const stop of [...stops, 'home'] as (keyof typeof PLACES)[]) {
        const dest = PLACES[stop].at;
        const cruise = p.key === 'maya' && stop !== 'home' ? 5 : 11 + rand() * 4;
        const leg = drive(streetPath(at, dest, rand), t, cruise, 15, rand);
        fixes.push(...leg.fixes);
        const stay = (stop === 'home' ? 0.5 : stop === 'work' || stop === 'school' ? 7 + rand() : 1 + rand()) * 3600_000;
        fixes.push(...dwell(dest, leg.end, leg.end + stay, rand));
        at = dest;
        t = leg.end + stay;
      }
      cursor = Math.min(t, dayStart + 86_400_000);
      if (dayStart + 86_400_000 > now) break;
    }
    fixes.push(...dwell(PLACES.home.at, cursor, now - 60_000, rand));
    fixes = fixes.filter((f) => (f.recordedAt as number) < now - 30_000);
    // Battery drains through the day and recharges overnight.
    for (const f of fixes) {
      const h = new Date(f.recordedAt as number).getHours();
      battery = h < 7 ? Math.min(100, battery + 2) : Math.max(8, battery - 0.08 - rand() * 0.05);
      f.battery = Math.round(battery);
      f.charging = h < 7;
    }
    const { userId, deviceId } = ids[p.key]!;
    for (let i = 0; i < fixes.length; i += 1000) {
      await ingestFixes(ctx, userId, deviceId, fixes.slice(i, i + 1000), { awaitTrips: true });
    }
    const { n } = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM trips WHERE user_id = ${userId}`)[0]!;
    console.log(`${p.name}: ${fixes.length.toLocaleString()} fixes, ${n} trips`);
  }
  await sql`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE is_demo)`;
  console.log('Demo data created. Demo accounts cannot sign in (random password).');
} else {
  // Rotate tokens so --live can drive an existing demo family.
  for (const p of PEOPLE) {
    const token = `ndd_${randomToken()}`;
    tokens[p.key] = token;
    await sql`UPDATE devices SET token_hash = ${sha256(token)}, token_hint = ${token.slice(-4)}
              WHERE user_id = (SELECT id FROM users WHERE email = ${`${p.key}@demo.nodara.ca`})`;
  }
}

await app.close();
await sql.end();

if (values.live) {
  // Drive Sam around Halifax in real time through the public HTTP API, so the
  // running server broadcasts updates to connected browsers exactly as it
  // would for a real phone.
  console.log(`Live simulation: Sam drives a loop every few minutes → ${values.url}`);
  const rand = rng(Date.now() % 1000);
  const loop: (keyof typeof PLACES)[] = ['work', 'grandma', 'gym', 'home'];
  let at: LL = PLACES.home.at;
  for (;;) {
    for (const stop of loop) {
      const leg = drive(streetPath(at, PLACES[stop].at, rand), Date.now(), 12, 5, rand);
      for (const f of leg.fixes) {
        f.recordedAt = new Date().toISOString();
        f.battery = 64;
        const res = await fetch(`${values.url}/api/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.sam}` },
          body: JSON.stringify({ locations: [f] }),
        });
        if (!res.ok) console.error('ingest failed', res.status, await res.text());
        await new Promise((r) => setTimeout(r, 5000));
      }
      at = PLACES[stop].at;
      for (let i = 0; i < 6; i++) {
        await fetch(`${values.url}/api/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.sam}` },
          body: JSON.stringify({ locations: [{ recordedAt: new Date().toISOString(), lat: at[0], lon: at[1], accuracy: 12, speed: 0, battery: 64 }] }),
        });
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }
}
