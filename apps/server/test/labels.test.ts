import { describe, expect, it, vi } from 'vitest';
import { poiLabel } from '../src/services/geocoder.js';
import { labelUnnamedTrips } from '../src/services/trips.js';
import { newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

describe('place names', () => {
  const at = { lat: 46.1, lon: -64.8 };
  const item = (o: Record<string, unknown>) =>
    ({ display_name: 'x', name: 'Walmart Supercentre', category: 'shop', type: 'supermarket', osm_type: 'way', lat: '46.1008', lon: '-64.8', address: { city: 'Moncton' }, ...o }) as never;

  it('uses the business you stopped at, including from a big store’s parking lot', () => {
    expect(poiLabel(item({}), at.lat, at.lon)).toBe('Walmart Supercentre, Moncton'); // ~90 m from the building centre
    expect(poiLabel(item({ osm_type: 'node' }), at.lat, at.lon)).toBeNull(); // a single point 90 m away is too far
    expect(poiLabel(item({ lat: '46.104' }), at.lat, at.lon)).toBeNull(); // 450 m away
    expect(poiLabel(item({ category: 'highway', type: 'bus_stop' }), at.lat, at.lon)).toBeNull();
    expect(poiLabel(item({ name: undefined }), at.lat, at.lon)).toBeNull();
  });

  it('follows GEOCODER_URL unless an admin chose otherwise', async () => {
    const s = env.ctx.settings;
    const cfg = env.ctx.config as { GEOCODER_URL: string };
    const original = cfg.GEOCODER_URL;
    cfg.GEOCODER_URL = 'https://geo.example';
    try {
      // A settings save from before GEOCODER_URL was set stored "off".
      await env.sql`INSERT INTO system_settings (key, value) VALUES ('system', ${env.sql.json({ geocodingEnabled: false, registrationPolicy: 'open' } as never)})
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
      s.invalidate();
      expect((await s.get()).geocodingEnabled).toBe(true);
      // An admin turning it off is respected.
      await s.update({ geocodingEnabled: false });
      s.invalidate();
      expect((await s.get()).geocodingEnabled).toBe(false);
    } finally {
      cfg.GEOCODER_URL = original;
      await env.sql`DELETE FROM system_settings WHERE key = 'system'`;
      s.invalidate();
    }
  });

  it('names trips that were recorded before a geocoder was set up', async () => {
    const u = await newUser(env, 'Namer');
    const place = (await u.client.post('/api/places', { name: 'Home', lat: 46.2, lon: -64.7, radiusM: 100 })).json();
    const [trip] = await env.sql<{ id: string }[]>`
      INSERT INTO trips (user_id, status, started_at, ended_at, start_lat, start_lon, end_lat, end_lon, route)
      VALUES (${u.id}, 'completed', now() - interval '1 hour', now() - interval '40 minutes', 46.1, -64.8, 46.2, -64.7,
              ST_GeogFromText('LINESTRING(-64.8 46.1, -64.7 46.2)'))
      RETURNING id`;
    const enabled = vi.spyOn(env.ctx.geocoder, 'enabled').mockResolvedValue(true);
    const reverse = vi.spyOn(env.ctx.geocoder, 'reverse').mockResolvedValue('Walmart Supercentre, Moncton');
    try {
      expect(await labelUnnamedTrips(env.ctx)).toBe(1);
      const [t] = await env.sql`SELECT start_label, end_label, end_place_id, labelled_at FROM trips WHERE id = ${trip!.id}`;
      expect(t).toMatchObject({ start_label: 'Walmart Supercentre, Moncton', end_label: 'Home', end_place_id: place.id });
      expect(t!.labelled_at).not.toBeNull();
      expect(await labelUnnamedTrips(env.ctx)).toBe(0); // each trip is tried once
    } finally {
      enabled.mockRestore();
      reverse.mockRestore();
    }
  });
});

describe('live path', () => {
  it('sends the uploaded path with each live location', async () => {
    const u = await newUser(env, 'Driver');
    const publish = vi.spyOn(env.ctx.hub, 'publish');
    try {
      const base = Date.now() - 10_000;
      await u.client.post('/api/locations', {
        deviceId: u.deviceId,
        locations: [0, 1, 2, 3].map((i) => ({ recordedAt: new Date(base + i * 1000).toISOString(), lat: 46 + i * 0.0002, lon: -64, accuracy: 5, speed: 20, heading: 0 })),
      });
      const event = publish.mock.calls.map((c) => c[1]).find((e) => e.type === 'location') as { trail: { lat: number }[] };
      expect(event.trail.map((p) => p.lat)).toEqual([46, 46.0002, 46.0004, 46.0006]);
    } finally {
      publish.mockRestore();
    }
  });
});
