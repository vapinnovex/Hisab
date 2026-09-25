import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'hisab.access-token';
// The browser sends its HttpOnly cookie; this marker is never a credential.
export const BROWSER_SESSION = 'browser-session';
export const tokenStorage = {
  get: () =>
    Platform.OS === 'web' ? Promise.resolve(BROWSER_SESSION) : SecureStore.getItemAsync(KEY),
  set: (token: string) => {
    if (Platform.OS === 'web') {
      return Promise.resolve();
    }
    return SecureStore.setItemAsync(KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  remove: () => {
    return Platform.OS === 'web' ? Promise.resolve() : SecureStore.deleteItemAsync(KEY);
  },
};
