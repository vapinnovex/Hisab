import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

const apiRoot = 'http://localhost:8001/api';
const webHeaders = { 'X-Hishob-Client': 'web', Origin: 'http://localhost:8082' };

test('synthetic setup, pairing, backend polling, collections, stale warning and revocation', async ({
  page,
  request,
}) => {
  await login(page, 'Owner', '+919855555091');
  await page.getByLabel('Shop name', { exact: true }).fill('Synthetic RadioSoft shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Hishob', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bills & Collections', exact: true })).toHaveCount(
    0,
  );
  const session = await page.request.get(`${apiRoot}/auth/me`);
  expect(session.ok()).toBeTruthy();
  const shop = (await session.json()).memberships[0].shop.id;
  const base = `${apiRoot}/shops/${shop}/radiosoft`;
  expect(
    (
      await page.request.post(`${apiRoot}/test-only/radiosoft/${shop}`, { headers: webHeaders })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'RadioSoft pilot setup', exact: true }).click();
  await page.getByRole('button', { name: 'Enable synthetic preview', exact: true }).click();
  await expect(page.getByText('Not paired', { exact: true })).toBeVisible();
  const pairingResponse = page.waitForResponse('**/radiosoft/pairing');
  await page.getByRole('button', { name: 'Create pairing code', exact: true }).click();
  const { code } = await (await pairingResponse).json();
  const credential = randomBytes(32).toString('base64url');
  const paired = await request.post(`${apiRoot}/radiosoft/connector/pair`, {
    data: { code, credential },
  });
  expect(paired.ok()).toBeTruthy();
  const { generation } = await paired.json();
  const headers = { Authorization: `Bearer ${credential}` };
  const observation = JSON.parse(
    readFileSync('../backend/tests/fixtures/radiosoft-observation.json', 'utf8'),
  );
  observation.generation = generation;
  observation.observed_at = new Date().toISOString();
  const send = async (sequence: number, net: string) => {
    const result = await request.post(`${apiRoot}/radiosoft/connector/observations`, {
      headers,
      data: { ...observation, sequence, amounts: { net_amt: net } },
    });
    expect(result.ok()).toBeTruthy();
  };
  await send(1, '1000');
  await request.post(`${apiRoot}/radiosoft/connector/health`, {
    headers,
    data: { status: 'OK', pending_observations: 0 },
  });
  await page.getByRole('button', { name: 'Bills & Collections', exact: true }).click();
  await expect(page.getByText('Connector connected', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Payable ₹1000.00 · Collected ₹0.00 · Outstanding ₹1000.00', { exact: true }),
  ).toBeVisible();
  // Observe a backend update through automatic polling, without clicking Refresh.
  await send(2, '1200');
  await expect(
    page.getByText('Payable ₹1200.00 · Collected ₹0.00 · Outstanding ₹1200.00', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Open bill 1001', exact: true }).click();
  await page.getByLabel('Cash amount', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(
    page.getByText('Payable ₹1200.00 · Collected ₹200.00 · Outstanding ₹1000.00', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mark paid without method', exact: true }).click();
  await expect(page.getByText('Paid—method not recorded', { exact: true })).toBeVisible();
  await page.getByLabel('UPI amount', { exact: true }).fill('1000');
  await page.getByLabel('Correction reason', { exact: true }).fill('Synthetic method confirmation');
  await page
    .getByRole('button', { name: 'Assign entered methods to this receipt', exact: true })
    .click();
  await expect(page.getByText('Paid—method not recorded', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Payable ₹1200.00 · Collected ₹1200.00 · Outstanding ₹0.00', { exact: true }),
  ).toBeVisible();
  // A source failure and failed page refresh must retain rows and visibly warn.
  await request.post(`${apiRoot}/radiosoft/connector/health`, {
    headers,
    data: { status: 'SOURCE_UNAVAILABLE', pending_observations: 3 },
  });
  await expect(
    page.getByText('Source needs attention: SOURCE_UNAVAILABLE', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.route('**/radiosoft/bills?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Synthetic outage' }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh bills', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Stale data — source changes may be missing. Check the connector before collecting.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Bill 1001', { exact: true })).toBeVisible();
  await page.unroute('**/radiosoft/bills?*');
  expect((await page.request.post(`${base}/revoke`, { headers: webHeaders })).ok()).toBeTruthy();
  expect(
    (
      await request.post(`${apiRoot}/radiosoft/connector/health`, {
        headers,
        data: { status: 'OK', pending_observations: 0 },
      })
    ).status(),
  ).toBe(401);
  const status = await (await page.request.get(`${base}/status`)).json();
  expect(
    (
      await page.request.put(`${base}/settings`, {
        headers: webHeaders,
        data: { revision: status.revision, mode: 'OFF' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh bills', exact: true }).click();
  await expect(page.getByText('Bill 1001', { exact: true })).toHaveCount(0);
});
