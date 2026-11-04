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
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'RadioSoft real DEV preview', exact: true }).click();
  await expect(page.getByText('Tracking starts: 2026-11-03', { exact: true })).toBeVisible();
  await page.getByLabel('Confirm source scope and tracking date').click();
  await page.getByRole('button', { name: 'Confirm DEV setup', exact: true }).click();
  await expect(page.getByText('Connection: Unpaired', { exact: true })).toBeVisible();
  const pairReply = page.waitForResponse('**/radiosoft-real/pairing');
  await page.getByRole('button', { name: 'Create five-minute pairing code', exact: true }).click();
  const { code } = await (await pairReply).json();
  const credential = 'r'.repeat(43);
  expect(
    (
      await request.post(api + '/radiosoft/real-connector/pair', { data: { code, credential } })
    ).ok(),
  ).toBeTruthy();
  const headers = { Authorization: `Bearer ${credential}` };
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
  await page.getByRole('button', { name: /back/i }).first().click();
  await page.getByRole('button', { name: 'RadioSoft real DEV preview', exact: true }).click();
  await expect(page.getByText('Signed source payable: ₹-61', { exact: true })).toBeVisible();
  await expect(page.getByText('Owed to customer: ₹61 · UNSETTLED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change mapping', exact: true }).click();
  await page.getByLabel('Audit reason', { exact: true }).fill('Owner verified source worker');
  await page.getByRole('button', { name: 'Link to Mapped worker', exact: true }).click();
  await expect(
    page.getByText('0 · Zero salesperson → Mapped worker', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop and revoke DEV connector', exact: true }).click();
  await expect(page.getByText('Connection: Disabled', { exact: true })).toBeVisible();
});
