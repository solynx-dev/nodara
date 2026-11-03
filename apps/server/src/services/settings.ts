import type { RegistrationPolicy } from '@nodara/shared';
import type { Sql } from '../db/index.js';
import type { Config } from '../config.js';

export interface SystemSettings {
  registrationPolicy: RegistrationPolicy;
  defaultRetentionDays: number; // 0 = forever
  telemetryEnabled: boolean;
  geocodingEnabled: boolean;
  /** Set once an admin has turned address lookups on or off themselves. */
  geocodingChosen?: boolean;
  offlineAfterMinutes: number;
  geofenceCooldownSec: number;
  /** New accounts must confirm their email before they can sign in (needs SMTP). */
  requireEmailVerification: boolean;
  trip: {
    departRadiusM: number;
    endAfterSec: number;
    minDistanceM: number;
  };
}

/**
 * Administrator-editable settings stored in `system_settings`, with defaults
 * coming from environment configuration. Cached in memory; writes go through
 * `update` which refreshes the cache.
 */
export class SettingsService {
  private cache: SystemSettings | null = null;

  constructor(
    private sql: Sql,
    private config: Config,
  ) {}

  defaults(): SystemSettings {
    return {
      registrationPolicy: this.config.registrationPolicyDefault,
      defaultRetentionDays: this.config.DEFAULT_RETENTION_DAYS,
      telemetryEnabled: false,
      geocodingEnabled: Boolean(this.config.GEOCODER_URL),
      offlineAfterMinutes: 120,
      geofenceCooldownSec: 180,
      requireEmailVerification: this.config.REQUIRE_EMAIL_VERIFICATION,
      trip: { departRadiusM: 200, endAfterSec: 300, minDistanceM: 400 },
    };
  }

  async get(): Promise<SystemSettings> {
    if (this.cache) return this.cache;
    const rows = await this.sql<{ value: Partial<SystemSettings> }[]>`
      SELECT value FROM system_settings WHERE key = 'system'`;
    const d = this.defaults();
    const stored = { ...(rows[0]?.value ?? {}) };
    // Saving any admin setting used to store "geocoding off" just because GEOCODER_URL
    // was empty at the time. Unless an admin chose it, follow GEOCODER_URL.
    if (!stored.geocodingChosen) delete stored.geocodingEnabled;
    this.cache = { ...d, ...stored, trip: { ...d.trip, ...(stored.trip ?? {}) } };
    return this.cache;
  }

  async update(patch: Partial<Omit<SystemSettings, 'trip'>> & { trip?: Partial<SystemSettings['trip']> }): Promise<SystemSettings> {
    const current = await this.get();
    const next = { ...current, ...patch, trip: { ...current.trip, ...(patch.trip ?? {}) } };
    if (patch.geocodingEnabled !== undefined && patch.geocodingEnabled !== current.geocodingEnabled) next.geocodingChosen = true;
    await this.sql`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('system', ${this.sql.json(next as never)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    this.cache = next;
    return next;
  }

  async getKey<T>(key: string): Promise<T | null> {
    const rows = await this.sql<{ value: T }[]>`SELECT value FROM system_settings WHERE key = ${key}`;
    return rows[0]?.value ?? null;
  }

  async setKey(key: string, value: unknown) {
    await this.sql`
      INSERT INTO system_settings (key, value, updated_at) VALUES (${key}, ${this.sql.json(value as never)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  invalidate() {
    this.cache = null;
  }
}
