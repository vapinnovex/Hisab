import { expect, test, Page, Locator } from '@playwright/test';
import { login } from './auth-helpers';

async function retryOrRecovered(button: Locator, ready: Locator) {
  // Polling/reconnect may finish recovery between the failed state and the tap.
  // Accept that only when the recovered content is actually visible.
  try {
    await button.click({ timeout: 1500 });
  } catch {
    await expect(ready).toBeVisible();
  }
}

async function setup(page: Page) {
  await login(page, 'Owner', '+9194' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Reliable shop');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  await page.getByLabel('Hishob tab', { exact: true }).click();
  await page.getByLabel('Opening cash', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  return `${response.url()}/${shop.id}/hishob`;
}

test('history retries initial failures, labels stale data and ignores superseded month responses', async ({
  page,
}) => {
  const base = await setup(page);
  let fail = true;
  await page.route('**/hishob/days?**', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { detail: 'History unavailable' } })
      : route.continue(),
  );
  await page.route('**/hishob/monthly-summary?**', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { detail: 'Summary unavailable' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry Hishob days', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry monthly summary', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Loading Hishob days…', { exact: true })).toHaveCount(0);
  fail = false;
  await retryOrRecovered(
    page.getByRole('button', { name: 'Retry monthly summary', exact: true }),
    page.getByText(/^Monthly sales ·/),
  );
  const { day } = await (await page.request.get(`${base}/today`)).json();
  const open = page.getByRole('button', { name: `Open Hishob · ${day.date}`, exact: true });
  await expect(open).toBeVisible();
  fail = true;
  await expect(
    page
      .getByText(
        'Showing previously loaded information. It may be out of date until refresh succeeds.',
      )
      .first(),
  ).toBeVisible({ timeout: 20000 });
  await expect(open).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('stale-history.png') });
  fail = false;
  await retryOrRecovered(
    page.getByRole('button', { name: 'Retry Hishob days', exact: true }),
    page.getByRole('button', { name: /^Open Hishob ·/ }),
  );
  await expect(
    page.getByText(
      'Showing previously loaded information. It may be out of date until refresh succeeds.',
    ),
  ).toHaveCount(0);
  await page.unroute('**/hishob/days?**');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let intercepted!: () => void;
  const received = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route('**/hishob/days?**', async (route) => {
    if (
      !route
        .request()
        .url()
        .includes(`from_date=${day.date.slice(0, 7)}`) &&
      !held
    ) {
      held = true;
      intercepted();
      await gate;
      await route.fulfill({ json: [] });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await received;
  await page.getByRole('button', { name: 'Current month', exact: true }).click();
  await expect(open).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/hishob/days?') &&
      !response.url().includes(`from_date=${day.date.slice(0, 7)}`),
  );
  release();
  await oldResponse;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(open).toBeVisible();
});

test('lost sale and closing responses recover from the server without duplicate writes', async ({
  page,
}) => {
  const base = await setup(page);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByLabel('Amount (₹)', { exact: true }).fill('125');
  await page.getByLabel('Description', { exact: true }).fill('Response lost sale');
  let writes = 0;
  await page.route('**/transactions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    const saved = await route.fetch();
    expect(saved.status()).toBe(201);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Save transaction', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
  expect(writes).toBe(1);
  let day = (await (await page.request.get(`${base}/today`)).json()).day;
  expect(day.transactions).toHaveLength(1);
  expect(day.cash_sales).toBe('125.00');
  await page.reload();
  await page.getByLabel('Hishob tab', { exact: true }).click();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByLabel('Actual cash in galla', { exact: true }).fill('1125');
  let closes = 0;
  await page.route('**/close', async (route) => {
    closes++;
    const saved = await route.fetch();
    expect(saved.status()).toBe(200);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  day = await (await page.request.get(`${base}/days/${day.id}`)).json();
  expect(day.status).toBe('CLOSED');
  expect(day.closing_snapshots).toHaveLength(1);
  expect(closes).toBe(1);
});

test('dues retry keeps balances and a lost payment response creates one receipt', async ({
  page,
}) => {
  const base = await setup(page);
  const headers = { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' };
  const { day } = await (await page.request.get(`${base}/today`)).json();
  const credit = await page.request.post(`${base}/days/${day.id}/transactions`, {
    headers,
    data: {
      revision: day.revision,
      request_id: 'credit-reliability',
      type: 'CREDIT_SALE',
      amount: '500',
      customer_name: 'Recovery customer',
      description: 'Unpaid bill',
    },
  });
  expect(credit.ok()).toBeTruthy();
  let fail = true;
  await page.route('**/dues?**', (route) =>
    fail ? route.fulfill({ status: 503, json: { detail: 'Dues unavailable' } }) : route.continue(),
  );
  await page.getByRole('button', { name: 'Customer dues', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry customer dues', exact: true }),
  ).toBeVisible();
  fail = false;
  await retryOrRecovered(
    page.getByRole('button', { name: 'Retry customer dues', exact: true }),
    page.getByText('Recovery customer', { exact: true }),
  );
  await expect(page.getByText('Recovery customer', { exact: true })).toBeVisible();
  fail = true;
  await expect(
    page.getByText(
      'Showing previously loaded information. It may be out of date until refresh succeeds.',
    ),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Recovery customer', { exact: true })).toBeVisible();
  fail = false;
  await retryOrRecovered(
    page.getByRole('button', { name: 'Retry customer dues', exact: true }),
    page.getByText('Recovery customer', { exact: true }),
  );
  await page.getByRole('button', { name: /Receive payment ·/ }).click();
  await page.getByLabel('Payment received (₹)', { exact: true }).fill('200');
  // Simulate polling switching to a new receipt day while this form remains open.
  const originalToday = await (await page.request.get(`${base}/today`)).json();
  const nextDate = new Date(`${originalToday.date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDay = nextDate.toISOString().slice(0, 10);
  await page.route('**/hishob/today', (route) =>
    route.fulfill({
      json: {
        ...originalToday,
        date: nextDay,
        day: { ...originalToday.day, id: 'different-day-after-midnight', date: nextDay },
      },
    }),
  );
  await page.waitForResponse('**/hishob/today');
  let writes = 0;
  await page.route('**/due-payments', async (route) => {
    expect(route.request().url()).toContain(`/days/${day.id}/due-payments`);
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
  // Retry after a lost response must resolve to the original receipt, even if polling advanced the revision.
  await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await expect(page.getByLabel('Payment received (₹)', { exact: true })).toHaveCount(0);
  const dues = await (await page.request.get(`${base}/dues`)).json();
  expect(dues.items[0].remaining_amount).toBe('300.00');
  expect(dues.items[0].payments).toHaveLength(1);
  expect(writes).toBe(2);
});

test('a stalled history request times out and can be retried', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let stalled = true;
  await page.route('**/hishob/days?**', async (route) => {
    if (stalled) {
      await gate;
      await route.abort().catch(() => undefined);
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  await expect(page.getByText('Loading Hishob days…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry Hishob days', exact: true })).toBeVisible({
    timeout: 22000,
  });
  await expect(page.getByText('Loading Hishob days…', { exact: true })).toHaveCount(0);
  stalled = false;
  release();
  await retryOrRecovered(
    page.getByRole('button', { name: 'Retry Hishob days', exact: true }),
    page.getByRole('button', { name: /^Open Hishob ·/ }),
  );
  await expect(page.getByRole('button', { name: /^Open Hishob ·/ })).toBeVisible();
});

test('failure before saving preserves the form and retry reuses its transaction reference', async ({
  page,
}) => {
  const base = await setup(page);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByLabel('Amount (₹)', { exact: true }).fill('75');
  await page.getByLabel('Description', { exact: true }).fill('Retry sale');
  const ids: string[] = [];
  await page.route('**/transactions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().request_id);
    if (ids.length === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await expect(page.getByText(/This change is not confirmed yet/)).toBeVisible();
  await expect(page.getByLabel('Amount (₹)', { exact: true })).toHaveValue('75');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Retry sale');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  const { day } = await (await page.request.get(`${base}/today`)).json();
  expect(day.transactions).toHaveLength(1);
  expect(day.cash_sales).toBe('75.00');
});

test('a concurrent edit blocks closing, preserves the form, and offers the latest day', async ({
  page,
}) => {
  const base = await setup(page);
  const { day } = await (await page.request.get(`${base}/today`)).json();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByLabel('Actual cash in galla', { exact: true }).fill('1000');
  const changed = await page.request.post(`${base}/days/${day.id}/transactions`, {
    headers: { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' },
    data: {
      revision: day.revision,
      request_id: 'concurrent-expense',
      type: 'EXPENSE',
      amount: '10',
      description: 'Another device',
    },
  });
  expect(changed.status()).toBe(201);
  const closing = page.waitForResponse('**/close');
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  expect((await closing).status()).toBe(409);
  await expect(page.getByLabel('Actual cash in galla', { exact: true })).toHaveValue('1,000');
  let latest = await (await page.request.get(`${base}/days/${day.id}`)).json();
  expect(latest.status).toBe('OPEN');
  expect(latest.closing_snapshots).toHaveLength(0);
  await page.screenshot({ path: test.info().outputPath('closing-conflict.png') });
  await page.getByRole('button', { name: 'Review latest day', exact: true }).click();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByLabel('Actual cash in galla', { exact: true }).fill('990');
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  latest = await (await page.request.get(`${base}/days/${day.id}`)).json();
  expect(latest.difference).toBe('0.00');
  expect(latest.closing_snapshots).toHaveLength(1);
});
