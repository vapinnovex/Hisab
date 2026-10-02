import { expect, test } from '@playwright/test';
import { onReconnect, setConnection } from '../src/connection';

test('mixed endpoint failures do not cause a reconnect storm; offline recovery still refreshes', async () => {
  let refreshes = 0;
  const unsubscribe = onReconnect(() => {
    refreshes++;
  });
  try {
    for (let index = 0; index < 20; index++) {
      setConnection('unavailable');
      setConnection('online');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshes).toBe(1);
    setConnection('offline');
    setConnection('online');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshes).toBe(2);
  } finally {
    unsubscribe();
  }
});
