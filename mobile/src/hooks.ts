import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { onReconnect } from './connection';
import { useAuth } from './auth';

export function useResource<T>(path: string, poll = false) {
  const { api } = useAuth();
  const focused = useIsFocused();
  const [result, setResult] = useState<{ path: string; data: T | null; error: string } | null>(
    null,
  );
  const sequenceRef = useRef({ value: 0, pending: false });
  const sequence = sequenceRef.current;
  const refresh = useCallback(async () => {
    const current = ++sequence.value;
    sequence.pending = true;
    try {
      const data = await api<T>(path);
      if (sequence.value === current) setResult({ path, data, error: '' });
    } catch (e) {
      if (sequence.value === current)
        setResult((old) => ({
          path,
          data: old?.path === path ? old.data : null,
          error: (e as Error).message,
        }));
    } finally {
      if (sequence.value === current) sequence.pending = false;
    }
  }, [api, path, sequence]);
  useEffect(() => {
    if (!focused) return;
    void refresh();
    const reconnect = onReconnect(() => void refresh());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const timer = poll
      ? setInterval(() => {
          if (AppState.currentState === 'active' && !sequence.pending) void refresh();
        }, 5000)
      : undefined;
    return () => {
      reconnect();
      subscription.remove();
      if (timer) clearInterval(timer);
      sequence.value++;
      sequence.pending = false;
    };
  }, [focused, refresh, poll, sequence]);
  return {
    data: result?.path === path ? result.data : null,
    error: result?.path === path ? result.error : '',
    loading: result?.path !== path,
    refresh,
  };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}
