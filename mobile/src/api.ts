import { Platform } from 'react-native';
import { browserOffline, setConnection, trackWrite } from './connection';

// Exported PWAs use the same-origin /api proxy, avoiding third-party cookie restrictions.
export const API_URL = (
  Platform.OS === 'web'
    ? (process.env.EXPO_PUBLIC_WEB_API_URL ??
      (__DEV__ ? process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000' : ''))
    : process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  token?: string | null,
  body?: unknown,
  method = 'GET',
): Promise<T> {
  if (Platform.OS === 'web' && browserOffline()) {
    setConnection('offline');
    throw new Error('You’re offline. Nothing was sent. Reconnect and try again.');
  }
  const finishWrite = method === 'GET' ? () => {} : trackWrite();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}/api${path}`, {
      method,
      ...(Platform.OS === 'web' ? { credentials: 'include' as const } : {}),
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        ...(Platform.OS === 'web'
          ? { 'X-Hishob-Client': 'web' }
          : token
            ? { Authorization: `Bearer ${token}` }
            : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    setConnection(response.status >= 500 ? 'unavailable' : 'online');
    if (response.status === 204) return undefined as T;
    const data = await response.json();
    if (!response.ok) {
      const detail = Array.isArray(data.detail)
        ? data.detail.map((item: { msg: string }) => item.msg).join('\n')
        : data.detail;
      throw new ApiError(
        response.status,
        response.status >= 500 && method !== 'GET'
          ? 'The server could not confirm this change. Refresh and check before trying again.'
          : typeof detail === 'string'
            ? detail
            : 'Something went wrong. Please try again.',
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    setConnection(browserOffline() ? 'offline' : 'unavailable');
    throw new Error(
      method === 'GET'
        ? 'Cannot reach Hishob. Check your connection and the API server address.'
        : 'Could not confirm this request. It may have reached Hishob. Reconnect and check before trying again.',
    );
  } finally {
    clearTimeout(timeout);
    finishWrite();
  }
}
