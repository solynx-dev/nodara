/**
 * Nodara brand colours, shared by the server (privacy page, emails) and the web
 * app (maps, SVG). The web app's CSS tokens in apps/web/src/styles.css and the
 * iOS theme in apps/mobile/src/lib/theme.ts mirror these values.
 */
export const BRAND = {
  purple: '#6D3EF5',
  purpleHover: '#5930DA',
  indigo: '#3967FF',
  blue: '#1FB6FF',
  violet: '#9342FA',
  pink: '#D94FF5',
  midnight: '#0B0D1C',
  midnightSurface: '#16182D',
  midnightBorder: '#2A2B46',
  textOnDark: '#F8F9FF',
  mutedOnDark: '#A6ABC5',
  /** Accent text and icons on midnight surfaces (6.7:1). */
  lavender: '#A98EFF',
} as const;

/** The signature gradient as [offset, colour] stops. */
export const BRAND_GRADIENT: [number, string][] = [
  [0, BRAND.blue],
  [0.32, BRAND.indigo],
  [0.7, BRAND.violet],
  [1, BRAND.pink],
];

export const BRAND_GRADIENT_CSS = `linear-gradient(120deg, ${BRAND_GRADIENT.map(([o, c]) => `${c} ${o * 100}%`).join(', ')})`;
