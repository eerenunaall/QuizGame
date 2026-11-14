import * as SecureStore from 'expo-secure-store';
import type { KeyValueStorage } from '@quizparty/controller-client';

/**
 * Keychain / Keystore backed storage for the controller-client (seat tokens, device id, sequence)
 * and for the account token. Keys are limited to `[A-Za-z0-9._-]` by the platform; the client's
 * keys (`qp.player.ABC234`, `qp.seq`, …) already comply.
 */
export const secureStorage: KeyValueStorage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
