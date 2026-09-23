import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'hisab.access-token';
// Web preview deliberately keeps tokens in memory. Native sessions use SecureStore.
let previewToken: string | null = null;
export const tokenStorage = {
  get: () =>
    Platform.OS === 'web' ? Promise.resolve(previewToken) : SecureStore.getItemAsync(KEY),
  set: (token: string) => {
    if (Platform.OS === 'web') {
      previewToken = token;
      return Promise.resolve();
    }
    return SecureStore.setItemAsync(KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  remove: () => {
    previewToken = null;
    return Platform.OS === 'web' ? Promise.resolve() : SecureStore.deleteItemAsync(KEY);
  },
};
