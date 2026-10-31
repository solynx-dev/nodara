import type { FastifyBaseLogger } from 'fastify';
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
  address?: Record<string, string>;
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

  /** Cached reverse lookup; returns null when geocoding is disabled or fails. */
  async reverse(lat: number, lon: number, opts: { cacheOnly?: boolean } = {}): Promise<string | null> {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = await this.sql<{ label: string | null }[]>`SELECT label FROM geocode_cache WHERE key = ${key}`;
    if (cached.length) return cached[0]!.label;
    if (opts.cacheOnly || !(await this.enabled())) return null;
    const item = await this.fetchJson<NominatimItem>('reverse', {
      lat: String(lat),
      lon: String(lon),
      format: 'jsonv2',
      zoom: '18',
      addressdetails: '1',
    });
    if (!item || !('display_name' in item)) return null;
    const label = Geocoder.shortLabel(item);
    await this.sql`
      INSERT INTO geocode_cache (key, label) VALUES (${key}, ${label}) ON CONFLICT (key) DO NOTHING`;
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
