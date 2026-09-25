import { useSyncExternalStore } from 'react';

export type Connection = 'online' | 'offline' | 'unavailable';
let state: Connection = 'online';
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
export const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
export function setConnection(next: Connection) {
  if (state === next) return;
  const previous = state;
  state = next;
  listeners.forEach((listener) => listener());
  if (next === 'online' && previous !== 'online') {
    // Finish the successful request before refreshing mounted resources.
    setTimeout(() => reconnectListeners.forEach((listener) => listener()), 0);
  }
}
export function onReconnect(listener: () => void) {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}
export function useConnection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
    () => 'online' as Connection,
  );
}

let pendingWrites = 0;
export const hasPendingWrites = () => pendingWrites > 0;
export function trackWrite() {
  pendingWrites++;
  return () => {
    pendingWrites--;
  };
}
