import { login } from './auth-helpers';
import { expect, test, Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

async function start(page: Page) {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('PWA Pilot Shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByLabel('Home tab', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await expect(page.getByRole('button', { name: 'Update Hishob', exact: true })).toHaveCount(0);
}

async function transaction(page: Page) {
  await page.getByLabel('Hishob tab', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill('1250');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Pilot cash sale');
}

test('installable shell, persistent HttpOnly login, offline cold start and logout', async ({
  page,
  context,
}, testInfo) => {
  await start(page);
  const cookies = await context.cookies('http://localhost:8083/api/auth/me');
  expect(cookies.find((cookie) => cookie.name === 'hishob_session')).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api',
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain('hishob_session');
  await page.reload();
  await expect(page.getByLabel('Home tab', { exact: true })).toBeVisible();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText('PWA Pilot Shop', { exact: true })).toBeVisible();
  await reopened.close();
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Hishob', display: 'standalone', start_url: '/' });
  for (const size of [192, 512]) {
    expect(
      await page.evaluate(async (size) => {
        const img = new Image();
        img.src = `/icons/hishob-${size}.png`;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      }, size),
    ).toEqual([size, size]);
  }
  await page.getByRole('button', { name: 'Install Hishob', exact: true }).click();
  await expect(page.getByText(/iPhone: open in Safari/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('install.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  const doneBounds = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox();
  expect(doneBounds!.y + doneBounds!.height).toBeLessThanOrEqual(568);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Let’s reconnect', { exact: true })).toBeVisible();
  await expect(page.getByText('You’re offline', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByLabel('Home tab', { exact: true })).toBeVisible();
  const cachePaths = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat(),
  );
  expect(cachePaths).toContain('/index.html');
  expect(cachePaths.some((path) => path.startsWith('/api'))).toBe(false);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.getByLabel('Account tab', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue as Owner', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue as Owner', exact: true })).toBeVisible();
});

test('offline forms retain amounts, saves are explicit, updates wait for unsaved work', async ({
  page,
  context,
}, testInfo) => {
  await start(page);
  await transaction(page);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/transactions')) writes++;
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(
    page.getByText('You’re offline. Nothing was sent. Reconnect and try again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount (₹)', exact: true })).toHaveValue('1,250');
  expect(writes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('offline-draft.png') });
  await context.setOffline(false);
  await expect(page.getByText('You’re offline', { exact: true })).toHaveCount(0);
  const worker = readFileSync('dist/sw.js', 'utf8');
  try {
    writeFileSync('dist/sw.js', worker + '\n// update test ' + Date.now());
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await page.getByRole('button', { name: 'Update Hishob', exact: true }).click();
    await expect(page.getByText(/Save or leave your open forms before updating/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
      'Pilot cash sale',
    );
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/transactions'),
    );
    await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
    expect(writes).toBe(1);
    const reloaded = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
    });
    await page.getByRole('button', { name: 'Update Hishob', exact: true }).click();
    await reloaded;
    await expect(page.getByLabel('Home tab', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update Hishob', exact: true })).toHaveCount(0);
  } finally {
    writeFileSync('dist/sw.js', worker);
  }
});

test('a lost save response stays unconfirmed and an explicit retry creates only one entry', async ({
  page,
}) => {
  await start(page);
  await transaction(page);
  let intercepted = false;
  let committedDay: { transactions: { description: string }[] } | undefined;
  await page.route('**/api/shops/*/hishob/days/*/transactions', async (route) => {
    if (route.request().method() !== 'POST' || intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committedDay = await response.json();
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(
    page.getByText(
      'Could not confirm this request. It may have reached Hishob. Reconnect and check before trying again.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Pilot cash sale',
  );
  expect(
    committedDay?.transactions.filter((entry) => entry.description === 'Pilot cash sale'),
  ).toHaveLength(1);
  const confirmation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/transactions'),
  );
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  const retried = await confirmation;
  expect(retried.ok()).toBe(true);
  const day = await retried.json();
  expect(
    day.transactions.filter(
      (entry: { description: string }) => entry.description === 'Pilot cash sale',
    ),
  ).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
});

test('login recovers if the first profile fetch fails after registration succeeds', async ({
  page,
}) => {
  let verified = false;
  let failed = false;
  page.on('response', (response) => {
    if (response.url().endsWith('/auth/owner/register/confirm') && response.ok()) verified = true;
  });
  await page.route('**/api/auth/me', async (route) => {
    if (verified && !failed) {
      failed = true;
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await start(page);
  expect(failed).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Home tab', { exact: true })).toBeVisible();
});
