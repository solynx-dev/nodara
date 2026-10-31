import {
  Baby,
  Briefcase,
  Coffee,
  Dumbbell,
  GraduationCap,
  Heart,
  Home,
  Hospital,
  MapPin,
  ShoppingCart,
  Star,
  Trees,
  type LucideIcon,
} from 'lucide-react';

export const PLACE_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  home: { icon: Home, label: 'Home' },
  work: { icon: Briefcase, label: 'Work' },
  school: { icon: GraduationCap, label: 'School' },
  daycare: { icon: Baby, label: 'Daycare' },
  gym: { icon: Dumbbell, label: 'Gym' },
  heart: { icon: Heart, label: 'Family' },
  cart: { icon: ShoppingCart, label: 'Shopping' },
  coffee: { icon: Coffee, label: 'Café' },
  hospital: { icon: Hospital, label: 'Health' },
  tree: { icon: Trees, label: 'Outdoors' },
  star: { icon: Star, label: 'Favourite' },
  pin: { icon: MapPin, label: 'Pin' },
};

export function PlaceIcon({ name, className }: { name: string; className?: string }) {
  const Icon = PLACE_ICONS[name]?.icon ?? MapPin;
  return <Icon className={className} />;
}

export const PLACE_COLORS = ['#FF6B3D', '#4C9AFF', '#2FBF71', '#B37FEB', '#F5A524', '#13C2C2', '#F56A9A', '#8A93A3'];
