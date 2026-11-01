import { Easing, FadeIn, FadeOut } from 'react-native-reanimated';

/**
 * Motion rules for the whole app: short, eased, and never bouncy.
 * No springs, no overshoot, no sliding cascades. Things simply fade, and
 * moving parts glide to a stop.
 */
export const EASE = Easing.out(Easing.cubic);

/** Moving parts (sheet, segmented control). */
export const GLIDE = { duration: 260, easing: EASE } as const;

/** Content appearing / disappearing. */
export const appear = FadeIn.duration(160);
export const disappear = FadeOut.duration(120);
