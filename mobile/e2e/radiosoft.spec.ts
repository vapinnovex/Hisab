import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

const apiRoot = `http://localhost:${process.env.HISHOB_E2E_API_PORT || '8001'}/api`;
const webHeaders = { 'X-Hishob-Client': 'web', Origin: 'http://localhost:8082' };

test('synthetic setup, pairing, backend polling, collections, stale warning and revocation', async ({
  page,
  request,
}, testInfo) => {
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
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Managers can view bills', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
  await expect(page.getByLabel('Managers can view bills', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
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
    page.getByLabel('Payable ₹1000.00 · Collected ₹0.00 · Outstanding ₹1000.00', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Evidence date', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Daily payment-app evidence', exact: true }).click();
  await expect(page.getByLabel('Evidence date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Daily payment-app evidence', exact: true }).click();
  await expect(page.getByLabel('Cash amount', { exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const balance = page.getByLabel('Payable ₹1000.00 · Collected ₹0.00 · Outstanding ₹1000.00', {
      exact: true,
    });
    const bounds = await balance.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`radiosoft-bills-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Observe a backend update through automatic polling, without clicking Refresh.
  await send(2, '1200');
  await expect(
    page.getByLabel('Payable ₹1200.00 · Collected ₹0.00 · Outstanding ₹1200.00', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Receiving now', { exact: true }).fill('200');
  await expect(
    page.getByText('Remaining after this payment: ₹1000.00', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(
    page.getByLabel('Payable ₹1200.00 · Collected ₹200.00 · Outstanding ₹1000.00', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Split payment', exact: true }).click();
  await page.getByLabel('Cash amount', { exact: true }).fill('300');
  await page.getByLabel('UPI amount', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(
    page.getByLabel('Payable ₹1200.00 · Collected ₹700.00 · Outstanding ₹500.00', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discount / waiver', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByLabel('Receiving now', { exact: true }).fill('400');
  await page.getByRole('button', { name: 'Discount remainder', exact: true }).click();
  await expect(page.getByLabel('Discount reason (optional)', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Discount ₹100.00; customer owes nothing after this payment.', { exact: true }),
  ).toBeVisible();
  // A committed receipt with a lost response must stay retryable even when it
  // leaves the Pending queue. Retrying cannot record another collection.
  await page.route('**/radiosoft/bills/*/collections', async (route) => {
    await route.fetch();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Synthetic lost response' }),
    });
    await page.unroute('**/radiosoft/bills/*/collections');
  });
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByRole('button', { name: 'Retry the same request', exact: true }).click();
  await expect(page.getByText('Bill 1001', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No pending bills', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settled (1)', exact: true }).click();
  await expect(page.getByText('Settled with waiver', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Payable ₹1200.00 · Collected ₹1100.00 · Outstanding ₹0.00', { exact: true }),
  ).toBeVisible();
  const billId = (await (await page.request.get(`${base}/bills`)).json()).bills[0].id;
  const detail = await (await page.request.get(`${base}/bills/${billId}`)).json();
  expect(detail.collections).toHaveLength(3);
  expect(detail.waivers).toHaveLength(1);
  await page.getByRole('button', { name: 'Open bill 1001', exact: true }).click();
  await page.getByLabel('Correction reason', { exact: true }).fill('Undo demo waiver');
  await page.getByRole('button', { name: 'Reverse waiver', exact: true }).click();
  await expect(page.getByText('Bill 1001', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pending (1)', exact: true }).click();
  await expect(
    page.getByLabel('Payable ₹1200.00 · Collected ₹1100.00 · Outstanding ₹100.00', { exact: true }),
  ).toBeVisible();
  // Keep a short payment as searchable customer credit, then collect later.
  await page.getByLabel('Receiving now', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Customer credit', exact: true }).click();
  await page.getByLabel('Customer name / bill reference', { exact: true }).fill('Demo Ravi');
  await page.getByLabel('Payment note', { exact: true }).fill('Will pay on Friday');
  await expect(page.getByRole('button', { name: 'Add payment note', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save customer credit', exact: true }).click();
  await expect(page.getByText('No pending bills', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Customer credit (1)', exact: true }).click();
  await page.getByLabel('Search bills, customers or notes', { exact: true }).fill('Ravi');
  await expect(page.getByText('Bill 1001', { exact: true })).toBeVisible();
  await page.getByLabel('Search bills, customers or notes', { exact: true }).fill('Friday');
  await expect(page.getByText('Bill 1001', { exact: true })).toBeVisible();
  await page.getByLabel('Receiving now', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(
    page.getByLabel('Payable ₹1200.00 · Collected ₹1140.00 · Outstanding ₹60.00', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open bill 1001', exact: true }).click();
  for (const label of ['Cash amount', 'UPI amount', 'Card amount'])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await page.getByLabel('Bill note', { exact: true }).fill('Called Monday to confirm');
  await page.getByRole('button', { name: 'Save bill note', exact: true }).click();
  await page.getByLabel('Search bills, customers or notes', { exact: true }).fill('Monday');
  await expect(page.getByText('Bill 1001', { exact: true })).toBeVisible();
  await page.getByLabel('Search bills, customers or notes', { exact: true }).fill('');
  await page.getByRole('button', { name: 'All bills (1)', exact: true }).click();
  // New bills arrive at the top; search operates on the complete backend queue.
  const newBill = await request.post(`${apiRoot}/radiosoft/connector/observations`, {
    headers,
    data: {
      ...observation,
      key: { ...observation.key, invoice_no: '1002' },
      sequence: 1,
      amounts: { net_amt: '250' },
      lines: [
        {
          description: 'Synthetic scarf',
          quantity: '1',
          amount: '250',
          salesperson_ref: 'demo-worker-2',
          salesperson_name: 'Demo Worker Two',
        },
      ],
    },
  });
  expect(newBill.ok()).toBeTruthy();
  await expect(page.getByText('Bill 1002', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Salesperson: Demo Worker Two', { exact: true })).toBeVisible();
  const top = await page.getByText('Bill 1002', { exact: true }).boundingBox();
  const older = await page.getByText('Bill 1001', { exact: true }).boundingBox();
  expect(top!.y).toBeLessThan(older!.y);
  await page.getByLabel('Search bills, customers or notes', { exact: true }).fill('002');
  await expect(page.getByText('Bill 1001', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Bill 1002', { exact: true })).toBeVisible();
  await page.getByLabel('Search bills, customers or notes', { exact: true }).fill('');
  await expect(page.getByText('Bill 1001', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Date & worker filters', exact: true }).click();
  await page.getByRole('button', { name: 'Demo Worker Two · demo-worker-2', exact: true }).click();
  await expect(page.getByText('Bill 1001', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All workers', exact: true }).click();
  await page.getByRole('button', { name: 'Date & worker filters', exact: true }).click();
  await expect(page.getByText('Bill 1001', { exact: true })).toBeVisible();
  const thirdBill = await request.post(`${apiRoot}/radiosoft/connector/observations`, {
    headers,
    data: {
      ...observation,
      key: { ...observation.key, invoice_no: '1003' },
      sequence: 1,
      amounts: { net_amt: '600' },
    },
  });
  expect(thirdBill.ok()).toBeTruthy();
  await expect(page.getByTestId('bill-card-1003')).toBeVisible({ timeout: 20000 });
  for (const [width, columns] of [
    [390, 1],
    [820, 2],
    [1440, 3],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(async () => {
        const boxes = await Promise.all(
          ['1001', '1002', '1003'].map((id) => page.getByTestId(`bill-card-${id}`).boundingBox()),
        );
        return new Set(boxes.map((box) => Math.round(box!.x))).size;
      })
      .toBe(columns);
    for (const id of ['1001', '1002', '1003']) {
      const box = (await page.getByTestId(`bill-card-${id}`).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeGreaterThan(250);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.getByTestId('bill-card-1003').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`radio-grid-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
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
