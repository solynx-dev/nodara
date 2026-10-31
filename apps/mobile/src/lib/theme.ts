import { PlatformColor, Platform, type ColorValue } from 'react-native';

/** iOS semantic system colours adapt to light/dark mode and accessibility settings automatically. */
const ios = (name: string, fallback: string): ColorValue => (Platform.OS === 'ios' ? PlatformColor(name) : fallback);

export const C = {
  accent: '#FF6B3D',
  accentSoft: 'rgba(255,107,61,0.14)',
  label: ios('label', '#111'),
  secondaryLabel: ios('secondaryLabel', '#666'),
  tertiaryLabel: ios('tertiaryLabel', '#999'),
  background: ios('systemBackground', '#fff'),
  groupedBackground: ios('systemGroupedBackground', '#f2f2f7'),
  cell: ios('secondarySystemGroupedBackground', '#fff'),
  fill: ios('tertiarySystemFill', '#eee'),
  separator: ios('separator', '#ddd'),
  green: ios('systemGreen', '#34c759'),
  orange: ios('systemOrange', '#ff9500'),
  red: ios('systemRed', '#ff3b30'),
  blue: ios('systemBlue', '#007aff'),
};
