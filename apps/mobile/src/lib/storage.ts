import * as SecureStore from 'expo-secure-store';

/**
 * Credentials live in the iOS Keychain. AFTER_FIRST_UNLOCK lets background
 * location tasks read them while the phone is locked in a pocket.
 */
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const KEYS = {
  server: 'nodara.server',
  session: 'nodara.session',
  deviceId: 'nodara.deviceId',
  deviceToken: 'nodara.deviceToken',
  tracking: 'nodara.tracking',
} as const;

export async function getItem(key: string) {
  return SecureStore.getItemAsync(key, OPTS);
}

export async function setItem(key: string, value: string | null) {
  if (value == null) await SecureStore.deleteItemAsync(key, OPTS);
  else await SecureStore.setItemAsync(key, value, OPTS);
}
