import type { FastifyBaseLogger } from 'fastify';
import { haversine } from '@nodara/shared';
import type { Sql } from '../db/index.js';
import type { Config } from '../config.js';
import type { SettingsService } from './settings.js';

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  type: string | null;
}

interface NominatimItem {
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
  type?: string;
  category?: string;
  osm_type?: string;
  address?: Record<string, string>;
}

/** Named places worth calling a destination ("Walmart Supercentre"), not street furniture or regions. */
const POI_CATEGORIES = new Set(['shop', 'amenity', 'leisure', 'tourism', 'office', 'craft', 'healthcare', 'building', 'club', 'sport', 'historic', 'aeroway', 'railway']);
const POI_SKIP_TYPES = new Set(['parking', 'parking_entrance', 'parking_space', 'bicycle_parking', 'bench', 'waste_basket', 'atm', 'toilets', 'post_box', 'vending_machine', 'recycling', 'charging_station', 'bus_stop', 'yes']);

/**
 * Use a nearby named business or venue as the label when there is one: a point
 * (node) within 75 m, or a building/area within 175 m of its centre (big stores
 * are wide, and people park out front).
 */
export function poiLabel(item: NominatimItem | null, lat: number, lon: number): string | null {
  if (!item || !item.name || !item.category) return null;
  if (!POI_CATEGORIES.has(item.category) || POI_SKIP_TYPES.has(item.type ?? '')) return null;
  const d = haversine(lat, lon, Number(item.lat), Number(item.lon));
  const max = item.osm_type === 'node' ? 75 : 175;
  if (!(d <= max)) return null;
  const a = item.address ?? {};
  const locality = a.city ?? a.town ?? a.village ?? a.suburb;
  return locality ? `${item.name}, ${locality}` : item.name;
}

/**
 * Optional geocoding through any Nominatim-compatible server (self-hosted
 * Nominatim, Photon's Nominatim shim, or the public OSM instance within its
 * usage policy). Geocoding is never required: without it Nodara shows
 * coordinates and saved place names.
 *
 * Requests are serialised and throttled to 1/s, and reverse lookups are cached
 * in Postgres at ~11 m resolution so repeated lookups never leave the server.
 */
export class Geocoder {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;

  constructor(
    private sql: Sql,
    private config: Config,
    private settings: SettingsService,
    private log: FastifyBaseLogger,
  ) {}

  async enabled() {
    return Boolean(this.config.GEOCODER_URL) && (await this.settings.get()).geocodingEnabled;
  }

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequest + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequest = Date.now();
      return fn();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async fetchJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(path, this.config.GEOCODER_URL.replace(/\/?$/, '/'));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.throttled(async () => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': this.config.GEOCODER_USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          this.log.warn({ status: res.status }, 'geocoder request failed');
          return null;
        }
        return (await res.json()) as T;
      } catch (err) {
        this.log.warn({ err }, 'geocoder unreachable');
        return null;
      }
    });
  }

  static shortLabel(item: NominatimItem): string {
    const a = item.address ?? {};
    const street = a.road ? (a.house_number ? `${a.house_number} ${a.road}` : a.road) : null;
    const locality = a.city ?? a.town ?? a.village ?? a.suburb ?? a.municipality ?? a.county;
    const poi = item.name && item.name !== a.road ? item.name : null;
    const parts = [poi ?? street, locality].filter(Boolean);
    return parts.length ? parts.join(', ') : item.display_name.split(',').slice(0, 2).join(',');
  }

  /**
   * Cached reverse lookup; returns null when geocoding is disabled or fails.
   * Prefers the business or venue you're at ("Walmart Supercentre, Moncton")
   * over its street address.
   */
  async reverse(lat: number, lon: number, opts: { cacheOnly?: boolean } = {}): Promise<string | null> {
    // v2: labels now prefer nearby businesses; older address-only entries are ignored.
    const key = `v2:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = await this.sql<{ label: string | null }[]>`SELECT label FROM geocode_cache WHERE key = ${key}`;
    if (cached.length) return cached[0]!.label;
    if (opts.cacheOnly || !(await this.enabled())) return null;
    const params = { lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '18', addressdetails: '1' };
    // Nominatim ≥ 4.3 can limit reverse lookups to points of interest.
    const poi = poiLabel(await this.fetchJson<NominatimItem>('reverse', { ...params, layer: 'poi' }), lat, lon);
    let label = poi;
    if (!label) {
      const item = await this.fetchJson<NominatimItem>('reverse', params);
      if (!item || !('display_name' in item)) return null;
      label = Geocoder.shortLabel(item);
    }
    await this.sql`
      INSERT INTO geocode_cache (key, label) VALUES (${key}, ${label}) ON CONFLICT (key) DO NOTHING`;
    return label;
  }

  /**
   * The town or district around a point ("Dieppe", "Downtown Moncton"), for
   * labelling a privacy bubble without pointing at any one address. Bigger
   * bubbles get a coarser name.
   */
  async area(lat: number, lon: number, radiusM: number): Promise<string | null> {
    if (!(await this.enabled())) return null;
    const zoom = radiusM <= 2_000 ? '14' : radiusM <= 15_000 ? '12' : '10';
    const key = `area${zoom}:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = await this.sql<{ label: string | null }[]>`SELECT label FROM geocode_cache WHERE key = ${key}`;
    if (cached.length) return cached[0]!.label;
    const item = await this.fetchJson<NominatimItem>('reverse', { lat: String(lat), lon: String(lon), format: 'jsonv2', zoom, addressdetails: '1' });
    if (!item) return null;
    const a = item.address ?? {};
    const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
    const part = zoom === '14' ? (a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? null) : null;
    const label = part && town && part !== town ? `${part}, ${town}` : (town ?? part ?? a.state ?? null);
    await this.sql`INSERT INTO geocode_cache (key, label) VALUES (${key}, ${label}) ON CONFLICT (key) DO NOTHING`;
    return label;
  }

  async search(q: string, near?: { lat: number; lon: number }): Promise<GeocodeResult[]> {
    if (!(await this.enabled())) return [];
    const params: Record<string, string> = { q, format: 'jsonv2', addressdetails: '1', limit: '8' };
    if (near) {
      const d = 0.5;
      params.viewbox = `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`;
    }
    const items = await this.fetchJson<NominatimItem[]>('search', params);
    return (items ?? []).map((i) => ({
      label: Geocoder.shortLabel(i),
      lat: Number(i.lat),
      lon: Number(i.lon),
      type: i.type ?? null,
    }));
  }
}
