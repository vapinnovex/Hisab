import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import { AppState } from 'react-native';
import { onReconnect } from './connection';
import { BROWSER_SESSION, tokenStorage } from './storage';
import { Membership, Session } from './types';

type Auth = {
  session: Session | null;
  selected: Membership | null;
  booting: boolean;
  bootError: string;
  select: (id: string) => void;
  restore: () => Promise<void>;
  signIn: (token?: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: (preferredShop?: string) => Promise<void>;
  api: <T>(path: string, body?: unknown, method?: string) => Promise<T>;
};
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedId, select] = useState<string>('');
  const token = useRef<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const clear = useCallback(async () => {
    token.current = null;
    setSession(null);
    select('');
    setBootError('');
    await tokenStorage.remove();
  }, []);
  const apply = useCallback((data: Session, preferredShop?: string) => {
    setSession(data);
    select(
      (old) =>
        data.memberships.find((m) => m.shop_id === preferredShop)?.id ||
        data.memberships.find((m) => m.id === old)?.id ||
        data.memberships[0]?.id ||
        '',
    );
  }, []);
  const reload = useCallback(
    async (preferredShop?: string) => {
      const usedToken = token.current;
      try {
        const data = await request<Session>('/auth/me', usedToken);
        if (token.current === usedToken) apply(data, preferredShop);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && token.current === usedToken)
          await clear();
        throw error;
      }
    },
    [apply, clear],
  );
  const restore = useCallback(
    () =>
      tokenStorage
        .get()
        .then(async (value) => {
          token.current = value;
          if (value) await reload();
          setBootError('');
        })
        .catch(async (error) => {
          if (error instanceof ApiError && error.status === 401) await clear();
          else setBootError((error as Error).message);
        })
        .finally(() => setBooting(false)),
    [reload, clear],
  );
  useEffect(() => {
    void restore();
  }, [restore]);
  const api = useCallback(
    async <T,>(path: string, body?: unknown, method = 'GET') => {
      const usedToken = token.current;
      try {
        return await request<T>(path, usedToken, body, method);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && token.current === usedToken)
          await clear();
        if (error instanceof ApiError && error.status === 403 && token.current === usedToken) {
          // A deactivated or reassigned membership must disappear without a restart.
          await reload().catch(() => undefined);
        }
        throw error;
      }
    },
    [clear, reload],
  );
  useEffect(
    () =>
      onReconnect(() => {
        if (token.current)
          void reload()
            .then(() => setBootError(''))
            .catch(() => undefined);
      }),
    [reload],
  );
  const signedIn = !!session;
  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => {
      if (AppState.currentState === 'active') void reload().catch(() => undefined);
    };
    const timer = setInterval(refresh, 5000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [signedIn, reload]);
  const signIn = useCallback(
    async (value = BROWSER_SESSION) => {
      // Keep the issued session if the first profile request loses connectivity.
      // Reconnection can then finish login without consuming another OTP.
      await tokenStorage.set(value);
      token.current = value;
      await reload();
    },
    [reload],
  );
  const signOut = useCallback(async () => {
    // Require server acknowledgment so logout really revokes the JWT session.
    try {
      if (token.current) await request('/auth/logout', token.current, undefined, 'POST');
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    await clear();
  }, [clear]);
  return (
    <Context.Provider
      value={{
        session,
        selected: session?.memberships.find((m) => m.id === selectedId) || null,
        booting,
        bootError,
        select,
        restore: async () => {
          setBooting(true);
          setBootError('');
          await restore();
        },
        signIn,
        signOut,
        reload,
        api,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('AuthProvider missing');
  return auth;
}
