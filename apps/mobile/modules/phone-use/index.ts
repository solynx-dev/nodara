import { requireOptionalNativeModule } from 'expo';

interface PhoneUseNative {
  /** Unlock times (epoch ms) recorded since the last call; clears them. */
  takeUnlocks(): number[];
  pendingCount(): number;
}

/** Null in Expo Go, on Android/web, and in builds made before this module existed. */
export const PhoneUse = requireOptionalNativeModule<PhoneUseNative>('PhoneUse');
