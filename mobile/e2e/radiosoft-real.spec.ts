import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';
const api = `http://localhost:${process.env.HISHOB_E2E_API_PORT || '8001'}/api`;
const web = { 'X-Hishob-Client': 'web', Origin: 'http://localhost:8082' };

test('real preview owner confirms scope, pairs, sees negative bill and maps zero salesperson', async ({
  page,
  request,
}) => {
  await login(page, 'Owner', '+919855555092');
  await page.getByLabel('Shop name', { exact: true }).fill('Real contract fixture shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Hishob', exact: true })).toBeVisible();
  const session = await (await page.request.get(api + '/auth/me')).json();
  const shop = session.memberships[0].shop.id;
  const scope = await (
    await page.request.post(`${api}/test-only/radiosoft-real/${shop}`, { headers: web })
  ).json();
  const workerResponse = await page.request.post(`${api}/shops/${shop}/workers`, {
    headers: web,
    data: { name: 'Mapped worker', mobile: '+919855555093' },
  });
  expect(workerResponse.ok()).toBeTruthy();
  await page
    .getByRole('button', { name: 'Live RadioSoft bills & collections (DEV)', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
  await expect(page.getByText('Tracking starts: 2026-11-03', { exact: true })).toBeVisible();
  await page.getByLabel('Confirm source scope and tracking date').click();
  await page.getByRole('button', { name: 'Confirm DEV setup', exact: true }).click();
  await expect(page.getByText('Connection: UNPAIRED', { exact: true })).toBeVisible();
  await expect(
    page.getByText('PC is unpaired. Open Connection settings to pair it.'),
  ).toBeVisible();
  const pairReply = page.waitForResponse('**/radiosoft-real/pairing');
  await page.getByRole('button', { name: 'Create five-minute pairing code', exact: true }).click();
  const { code } = await (await pairReply).json();
  expect(code).toMatch(/^[0-9]{8}$/);
  await expect(page.getByLabel('Pairing code', { exact: true })).toHaveText(
    code.slice(0, 4) + ' ' + code.slice(4),
  );
  await expect(page.getByText('Enter this code on your shop PC.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/real-pairing.png', fullPage: true });
  await page.getByRole('button', { name: 'Bills', exact: true }).click();
  await page.getByLabel('Bill date (YYYY-MM-DD)', { exact: true }).fill('2026-11-03');
  await page.getByRole('button', { name: 'Find bills', exact: true }).click();
  await expect(
    page.getByText('No imported bills for this date yet.', { exact: true }),
  ).toBeVisible();
  const credential = 'r'.repeat(43);
  expect(
    (
      await request.post(api + '/radiosoft/real-connector/pair', { data: { code, credential } })
    ).ok(),
  ).toBeTruthy();
  const headers = { Authorization: `Bearer ${credential}` };
  await page.getByRole('button', { name: 'Refresh imported bills', exact: true }).click();
  await expect(
    page.getByText('PC is disconnected. Check the shop PC and internet connection.').first(),
  ).toBeVisible();
  for (const healthStatus of ['SOURCE_UNAVAILABLE', 'OK']) {
    const reply = await request.post(api + '/radiosoft/real-connector/health', {
      headers,
      data: { status: healthStatus, pending_observations: 0, last_successful_source_read: null },
    });
    expect(reply.ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Refresh imported bills', exact: true }).click();
    await expect(
      page
        .getByText(
          healthStatus === 'OK'
            ? 'Waiting for the first successful source read.'
            : 'Source read failed or is incomplete. Open Connection settings for details.',
        )
        .first(),
    ).toBeVisible();
  }
  const refreshReply = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/shops/${shop}/radiosoft-real/refresh`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Refresh from shop PC', exact: true }).click();
  const { request_id: requestId } = await (await refreshReply).json();
  const command = await request.post(api + '/radiosoft/real-connector/command', {
    headers,
    data: {},
  });
  expect((await command.json()).scan_request_id).toBe(requestId);
  const completedScan = await request.post(api + '/radiosoft/real-connector/health', {
    headers,
    data: {
      status: 'OK',
      pending_observations: 0,
      last_successful_source_read: new Date().toISOString(),
      scan_request_ack: requestId,
    },
  });
  expect(completedScan.ok()).toBeTruthy();
  await expect(
    page.getByText('The shop PC scan finished. Showing the latest bills received by Hishob.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  const envelope = {
    version: 2,
    synthetic: false,
    mapping_version: 'real-display-v1',
    source_id: scope.source_id,
    generation: scope.generation,
    observed_at: new Date().toISOString(),
  };
  expect(
    (
      await request.post(api + '/radiosoft/real-connector/observations', {
        headers,
        data: {
          ...envelope,
          sequence: 1,
          kind: 'DIRECTORY',
          bill: null,
          people: [{ ref: '0', name: 'Zero salesperson' }],
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post(api + '/radiosoft/real-connector/observations', {
        headers,
        data: {
          ...envelope,
          sequence: 2,
          kind: 'BILL',
          people: [],
          bill: {
            key: { invoice_no: '1', fyear: '2026 - 2027', invoice_type: 0, firm_code: 0 },
            business_date: '2026-11-03',
            net_amt: '-61',
            raw_header: { NetAmt: '-61', ExchangeAmt: '1800' },
            lines: [
              {
                raw: { SLNo: 0, NetAmt: '1739' },
                salesperson_ref: '0',
                salesperson_name: 'Zero salesperson',
                attribution_status: 'RESOLVED_LOOKUP',
              },
            ],
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  // Polling imports without leaving the empty daily screen.
  await expect(page.getByText('Amount owed to customer: ₹61', { exact: true })).toBeVisible({
    timeout: 25000,
  });
  const negativeBill = page.getByTestId('real-bill-card-1');
  await expect(negativeBill.getByRole('button', { name: 'Mark paid without method' })).toHaveCount(
    0,
  );
  expect(
    (
      await request.post(api + '/radiosoft/real-connector/observations', {
        headers,
        data: {
          ...envelope,
          sequence: 3,
          kind: 'BILL',
          people: [],
          bill: {
            key: { invoice_no: '2', fyear: '2026 - 2027', invoice_type: 0, firm_code: 0 },
            business_date: '2026-11-03',
            net_amt: '100.00',
            raw_header: { NetAmt: '100.00' },
            lines: [],
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  const secondBill = page.getByTestId('real-bill-card-2');
  await expect(secondBill).toBeVisible({ timeout: 25000 });
  await expect(page.getByText('RadioSoft totals for selected date', { exact: true })).toBeVisible();
  await expect(page.getByText('₹39.00', { exact: true })).toBeVisible();
  const billOrder = await page
    .locator('[data-testid^="real-bill-card-"]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid')));
  expect(billOrder).toEqual(['real-bill-card-2', 'real-bill-card-1']);
  await secondBill.getByRole('button', { name: 'Split', exact: true }).click();
  await secondBill.getByLabel('Cash amount', { exact: true }).fill('10');
  await secondBill.getByLabel('UPI amount', { exact: true }).fill('15');
  await secondBill.getByRole('button', { name: 'Record partial / full collection' }).click();
  await expect(secondBill.getByText('Partially paid', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await secondBill.getByRole('button', { name: 'Open bill 2', exact: true }).click();
  const billDialog = page.getByRole('dialog');
  await expect(billDialog.getByText('Partially paid', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    billDialog.getByText('Source payable ₹100.00 · Recorded ₹25.00 · Remaining ₹75.00', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close bill', exact: true }).click();
  await secondBill.getByRole('button', { name: 'UPI', exact: true }).click();
  await secondBill.getByRole('button', { name: 'Use full balance', exact: true }).click();
  await expect(secondBill.getByLabel('Collection amount', { exact: true })).toHaveValue('75.00');
  await secondBill.getByRole('button', { name: 'Record partial / full collection' }).click();
  await expect(secondBill.getByText('Paid', { exact: true })).toBeVisible({ timeout: 15000 });
  await secondBill.getByRole('button', { name: 'Open bill 2', exact: true }).click();
  const paidBillDialog = page.getByRole('dialog');
  await expect(paidBillDialog.getByText('Paid', { exact: true })).toBeVisible();
  await expect(
    paidBillDialog.getByText('Source payable ₹100.00 · Recorded ₹100.00 · Remaining ₹0.00', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close bill', exact: true }).click();
  expect(
    (
      await request.post(api + '/radiosoft/real-connector/observations', {
        headers,
        data: {
          ...envelope,
          sequence: 4,
          kind: 'BILL',
          people: [],
          bill: {
            key: { invoice_no: '3', fyear: '2026 - 2027', invoice_type: 0, firm_code: 0 },
            business_date: '2026-11-03',
            net_amt: '50.00',
            raw_header: { NetAmt: '50.00' },
            lines: [],
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  const thirdBill = page.getByTestId('real-bill-card-3');
  await expect(thirdBill).toBeVisible({ timeout: 15000 });
  await thirdBill.getByRole('button', { name: 'Mark paid without method' }).click();
  await expect(thirdBill.getByText('Paid', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'test-results/real-bills.png', fullPage: true });
  await page.getByRole('button', { name: 'Open bill 1', exact: true }).click();
  await expect(
    page.getByText('RadioSoft salesperson: 0 · Zero salesperson', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/real-bill-detail.png', fullPage: true });
  await page.getByRole('button', { name: 'Close bill', exact: true }).click();
  await page.getByRole('button', { name: 'Manage links', exact: true }).first().click();
  await page.getByRole('button', { name: 'Link to staff', exact: true }).click();
  await page.getByLabel('Search staff', { exact: true }).fill('Mapped');
  await page.getByRole('button', { name: /^Mapped worker ·/ }).click();
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(
    page.getByText('No salespeople need linking. New source entries will appear here.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Linked', exact: true }).click();
  await expect(page.getByText('Mapped worker', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/real-links.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /back/i }).first().click();
  await page
    .getByRole('button', { name: 'Live RadioSoft bills & collections (DEV)', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
  await page.getByRole('button', { name: 'Stop and revoke DEV connector', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm revoke', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm revoke', exact: true }).click();
  await expect(page.getByText('Connection: DISABLED', { exact: true })).toBeVisible();
});

test('status failure stays visible, retries, and access rejection hides protected data', async ({
  page,
}) => {
  await login(page, 'Owner', '+919855555094');
  await page.getByLabel('Shop name', { exact: true }).fill('Real retry fixture shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Hishob', exact: true })).toBeVisible();
  const session = await (await page.request.get(api + '/auth/me')).json();
  const shop = session.memberships[0].shop.id;
  await page.request.post(`${api}/test-only/radiosoft-real/${shop}`, { headers: web });
  let failure = 503;
  await page.route('**/radiosoft-real/status', async (route) => {
    if (failure)
      await route.fulfill({ status: failure, json: { detail: 'Fixture status failure' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await expect(
    page.getByText('RadioSoft status is unavailable. Eligibility could not be checked.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Live RadioSoft bills & collections (DEV)', exact: true }),
  ).toHaveCount(0);
  failure = 0;
  await page.getByRole('button', { name: 'Retry RadioSoft status', exact: true }).click();
  await page
    .getByRole('button', { name: 'Live RadioSoft bills & collections (DEV)', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
  await expect(page.getByText('Tracking starts: 2026-11-03', { exact: true })).toBeVisible();
  failure = 503;
  await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
  await expect(
    page.getByText(
      'Connection status could not refresh. Showing previously authorized data; it may be stale.',
    ),
  ).toBeVisible();
  failure = 0;
  await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
  await expect(page.getByText('Tracking starts: 2026-11-03', { exact: true })).toBeVisible();
  failure = 403;
  await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
  await expect(
    page.getByText('RadioSoft preview access was rejected. No preview data is shown.'),
  ).toBeVisible();
  await expect(page.getByText('Tracking starts: 2026-11-03', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm DEV setup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /back/i }).first().click();
  await expect(
    page.getByText('RadioSoft preview access was rejected. No preview data is shown.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Live RadioSoft bills & collections (DEV)', exact: true }),
  ).toHaveCount(0);
});
