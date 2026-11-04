import { DynamicColorIOS, PlatformColor, Platform, type ColorValue, type TextStyle } from 'react-native';

/** A colour that follows light/dark mode (iOS), falling back to the light value elsewhere. */
const dyn = (light: string, dark: string): ColorValue => (Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : light);
/** iOS semantic system colours, for status meanings (success, warning, error…). */
const ios = (name: string, fallback: string): ColorValue => (Platform.OS === 'ios' ? PlatformColor(name) : fallback);

/**
 * Nodara brand palette. Mirrors packages/shared/src/brand.ts and the web
 * tokens in apps/web/src/styles.css. Use the tokens in `C` in components.
 */
export const BRAND = {
  purple: '#6D3EF5',
  purpleHover: '#5930DA',
  indigo: '#3967FF',
  blue: '#1FB6FF',
  violet: '#9342FA',
  pink: '#D94FF5',
  /** Pink dark enough for white text on top (5.3:1). */
  pinkStrong: '#A932C4',
  midnight: '#0B0D1C',
  midnightSurface: '#16182D',
  midnightRaised: '#1D1F38',
  midnightBorder: '#2A2B46',
  lavender: '#A98EFF',
  /** The signature gradient (120°), for the few places that use it. */
  gradient: ['#1FB6FF', '#3967FF', '#9342FA', '#D94FF5'],
} as const;

/**
 * Design tokens. Light mode: off-white with a faint violet tint. Dark mode:
 * midnight navy surfaces (never pure black). Contrast (WCAG AA): white on
 * `accent` 5.7:1; `accentText` 5.2:1 (light) / 6.1:1+ (dark); `secondaryLabel`
 * 5.4:1 / 7.7:1.
 */
export const C = {
  /** Fills: buttons, switches, selection, badges, the selected-person ring. Always a plain hex string. */
  accent: BRAND.purple,
  accentPressed: BRAND.purpleHover,
  /** Accent-coloured text and icons (lighter in dark mode so they stay readable). */
  accentText: dyn(BRAND.purple, BRAND.lavender),
  accentSoft: dyn('rgba(109,62,245,0.12)', 'rgba(109,62,245,0.26)'),
  label: dyn('#12132A', '#F8F9FF'),
  secondaryLabel: dyn('#5E6280', '#A6ABC5'),
  tertiaryLabel: dyn('rgba(18,19,42,0.36)', 'rgba(166,171,197,0.55)'),
  background: dyn('#FFFFFF', BRAND.midnight),
  groupedBackground: dyn('#F4F3FA', BRAND.midnight),
  cell: dyn('#FFFFFF', BRAND.midnightSurface),
  elevated: dyn('#F8F7FD', BRAND.midnightRaised),
  fill: dyn('rgba(40,36,96,0.07)', 'rgba(166,171,197,0.13)'),
  fillStrong: dyn('rgba(40,36,96,0.11)', 'rgba(166,171,197,0.2)'),
  separator: dyn('rgba(22,20,64,0.13)', BRAND.midnightBorder),
  /** Bubbles (privacy areas) are brand pink, so they never read as a button. Text version passes AA. */
  bubbleText: dyn(BRAND.pinkStrong, BRAND.pink),
  green: ios('systemGreen', '#34c759'),
  orange: ios('systemOrange', '#ff9500'),
  red: ios('systemRed', '#ff3b30'),
  blue: ios('systemBlue', '#007aff'),
  indigo: ios('systemIndigo', '#5856d6'),
  gray: ios('systemGray', '#8e8e93'),
};

/** Navigation chrome colours per scheme (React Navigation needs plain strings). */
export const NAV = {
  light: { background: '#F4F3FA', card: '#FFFFFF', text: '#12132A', border: 'rgba(22,20,64,0.13)' },
  dark: { background: BRAND.midnight, card: BRAND.midnightSurface, text: '#F8F9FF', border: BRAND.midnightBorder },
};

/** Fixed hex values for places where PlatformColor can't be used (map markers, alpha mixing). */
export const HEX = { green: '#34C759', orange: '#FF9500', red: '#FF3B30', blue: '#007AFF', gray: '#8E8E93', purple: BRAND.purple, pink: BRAND.pink };

/** Apple's text styles; React Native scales them with Dynamic Type. */
export const T: Record<'largeTitle' | 'title1' | 'title2' | 'title3' | 'headline' | 'body' | 'callout' | 'subhead' | 'footnote' | 'caption', TextStyle> = {
  largeTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.4 },
  title1: { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  title2: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  title3: { fontSize: 20, fontWeight: '600' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  subhead: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12, fontWeight: '600' },
};

