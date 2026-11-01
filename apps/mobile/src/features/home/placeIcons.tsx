import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

/** Server place icon names → SF Symbols. */
export const PLACE_SYMBOLS: Record<string, SFSymbol> = {
  home: 'house.fill',
  work: 'briefcase.fill',
  school: 'graduationcap.fill',
  daycare: 'figure.and.child.holdinghands',
  gym: 'dumbbell.fill',
  heart: 'heart.fill',
  cart: 'cart.fill',
  coffee: 'cup.and.saucer.fill',
  hospital: 'cross.case.fill',
  tree: 'tree.fill',
  star: 'star.fill',
  pin: 'mappin',
};

export function PlaceSymbol({ icon, size, color }: { icon: string; size: number; color: ColorValue }) {
  return <SymbolView name={PLACE_SYMBOLS[icon] ?? 'mappin'} size={size} tintColor={color} />;
}
