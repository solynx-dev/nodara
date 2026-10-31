import { PlatformColor, Platform, type ColorValue, type TextStyle } from 'react-native';

/** iOS semantic system colours adapt to light/dark mode and accessibility settings automatically. */
const ios = (name: string, fallback: string): ColorValue => (Platform.OS === 'ios' ? PlatformColor(name) : fallback);

export const C = {
  accent: '#FF6B3D',
  accentSoft: 'rgba(255,107,61,0.15)',
  label: ios('label', '#111'),
  secondaryLabel: ios('secondaryLabel', '#666'),
  tertiaryLabel: ios('tertiaryLabel', '#999'),
  background: ios('systemBackground', '#fff'),
  groupedBackground: ios('systemGroupedBackground', '#f2f2f7'),
  cell: ios('secondarySystemGroupedBackground', '#fff'),
  elevated: ios('tertiarySystemGroupedBackground', '#f7f7f7'),
  fill: ios('tertiarySystemFill', '#eee'),
  fillStrong: ios('secondarySystemFill', '#e5e5ea'),
  separator: ios('separator', '#ddd'),
  green: ios('systemGreen', '#34c759'),
  orange: ios('systemOrange', '#ff9500'),
  red: ios('systemRed', '#ff3b30'),
  blue: ios('systemBlue', '#007aff'),
  indigo: ios('systemIndigo', '#5856d6'),
  gray: ios('systemGray', '#8e8e93'),
};

/** Fixed hex values for places where PlatformColor can't be used (map markers, alpha mixing). */
export const HEX = { green: '#34C759', orange: '#FF9500', red: '#FF3B30', blue: '#007AFF', gray: '#8E8E93' };

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

export const SPRING = { damping: 22, stiffness: 240, mass: 0.9 } as const;
