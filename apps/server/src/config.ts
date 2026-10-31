import { z } from 'zod';
import type { MapStyleOption, RegistrationPolicy } from '@nodara/shared';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(8080),
  /** Public base URL, e.g. https://nodara.example.com — used for links, cookies and WebAuthn. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://nodara:nodara@localhost:5432/nodara'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  INSTANCE_NAME: z.string().default('Nodara'),
  /** Used to sign nothing secret-critical today but reserved for future HMAC needs; must be set in production. */
  SESSION_SECRET: z.string().min(16).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  TRUST_PROXY: bool.default(false),
  REGISTRATION_POLICY: z.enum(['open', 'invite', 'closed']).default('invite'),
  /** If set, the first-run setup screen requires this token. */
  SETUP_TOKEN: z.string().optional(),
  REQUIRE_EMAIL_VERIFICATION: bool.default(false),

  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('Nodara <nodara@localhost>'),

  /** JSON array of {id,name,url,dark} map styles. */
  MAP_STYLES: z.string().optional(),
  /** Nominatim-compatible base URL. Empty disables geocoding. */
  GEOCODER_URL: z.string().default(''),
  GEOCODER_USER_AGENT: z.string().default('Nodara self-hosted (https://nodara.ca)'),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

  /** Default retention for location history in days. 0 / empty = keep forever. */
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),

  /** Telemetry is OFF unless an admin enables it *and* an endpoint is configured. */
  TELEMETRY_ENDPOINT: z.string().default(''),

  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  /** Disables background schedulers (used in tests). */
  DISABLE_JOBS: bool.default(false),
});

export type Config = z.infer<typeof schema> & {
  mapStyles: MapStyleOption[];
  registrationPolicyDefault: RegistrationPolicy;
  secureCookies: boolean;
  rpId: string;
  origin: string;
};

export const DEFAULT_MAP_STYLES: MapStyleOption[] = [
  { id: 'liberty', name: 'Streets', url: 'https://tiles.openfreemap.org/styles/liberty', dark: false },
  { id: 'positron', name: 'Light', url: 'https://tiles.openfreemap.org/styles/positron', dark: false },
  { id: 'dark', name: 'Dark', url: 'https://tiles.openfreemap.org/styles/dark', dark: true },
  { id: 'fiord', name: 'Fiord', url: 'https://tiles.openfreemap.org/styles/fiord', dark: true },
  // Plain OpenStreetMap raster tiles, generated client-side (no style server needed).
  { id: 'osm-raster', name: 'OSM Raster', url: 'builtin:osm-raster', dark: false },
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && !c.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set (at least 16 characters) in production.');
  }
  let mapStyles = DEFAULT_MAP_STYLES;
  if (c.MAP_STYLES) {
    const styleSchema = z.array(
      z.object({ id: z.string(), name: z.string(), url: z.string(), dark: z.boolean().default(false) }),
    );
    mapStyles = styleSchema.parse(JSON.parse(c.MAP_STYLES));
  }
  const url = new URL(c.PUBLIC_URL);
  return {
    ...c,
    mapStyles,
    registrationPolicyDefault: c.REGISTRATION_POLICY,
    secureCookies: url.protocol === 'https:',
    rpId: url.hostname,
    origin: url.origin,
  };
}
