import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

test('Hishob overview keeps daily actions accessible and shows saved closing cash', async ({
  page,
}, info) => {
  const textNodeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Unexpected text node')) textNodeErrors.push(message.text());
  });
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Hishob UI shop');
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  const endpoint = `${response.url()}/${shop.id}/hishob`;
  const headers = { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' };
  await page.getByRole('button', { name: 'Open Hishob', exact: true }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 740 });
    await expect(
      page.getByRole('button', { name: 'Start today’s Hishob', exact: true }),
    ).toBeInViewport();
    await expect(page.getByLabel('Opening cash', { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`hishob-start-${width}.png`) });
  }
  expect(textNodeErrors).toEqual([]);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByLabel('Opening cash', { exact: true }).fill('2000');
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  await expect(page.getByLabel('Current galla: ₹2,000', { exact: true })).toBeVisible();
  let day = (await (await page.request.get(`${endpoint}/today`)).json()).day;
  for (const [index, entry] of [
    { type: 'CASH_SALE', amount: '1500', description: 'Counter sales', payment_method: 'CASH' },
    { type: 'DIGITAL_SALE', amount: '800', description: 'UPI sales', payment_method: 'CASH' },
    { type: 'EXPENSE', amount: '200', description: 'Delivery charges', payment_method: 'CASH' },
    { type: 'EXPENSE', amount: '50', description: 'Phone recharge', payment_method: 'DIGITAL' },
  ].entries()) {
    const saved = await page.request.post(`${endpoint}/days/${day.id}/transactions`, {
      headers,
      data: { ...entry, request_id: `overview-entry-${index}`, revision: day.revision },
    });
    expect(saved.ok()).toBeTruthy();
    day = await saved.json();
  }
  const refresh = async () => {
    await page.getByLabel('Home tab', { exact: true }).click();
    await page.getByLabel('Hishob tab', { exact: true }).click();
  };
  await refresh();
  await expect(page.getByLabel('Current galla: ₹3,300', { exact: true })).toBeVisible();
  await expect(page.getByText('₹2,300', { exact: true })).toBeVisible();
  await expect(page.getByText('₹250', { exact: true })).toBeVisible();
  await expect(page.getByText('Phone recharge', { exact: true })).toBeVisible();
  await expect(page.getByText('Counter sales', { exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      'Add transaction',
      'Close day',
      'Calculator',
      'Hishob history',
      'Customer dues',
    ]) {
      const action = page.getByRole('button', { name, exact: true });
      await expect(action).toBeInViewport();
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: info.outputPath(`hishob-open-${width}.png`) });
  }
  const breakdown = page.getByRole('button', { name: 'Cash breakdown', exact: true });
  await expect(breakdown).toHaveAttribute('aria-expanded', 'false');
  await breakdown.click();
  await expect(breakdown).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('− Cash expenses', { exact: true })).toBeVisible();
  await breakdown.click();
  await page.setViewportSize({ width: 320, height: 844 });
  const route = '**/api/shops/*/hishob/today';
  await page.route(route, async (request) => {
    const result = await request.fetch();
    const data = await result.json();
    await request.fulfill({
      json: {
        ...data,
        day: {
          ...data.day,
          expected_closing_cash: '999999999.99',
          total_sales: '999999999.99',
          expenses_total: '999999999.99',
        },
      },
    });
  });
  await refresh();
  await expect(page.getByLabel('Current galla: ₹99,99,99,999.99', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('hishob-large-amounts.png') });
  // Drain in-flight polling responses before removing this mock.
  await page.unrouteAll({ behavior: 'wait' });
  const closed = await page.request.post(`${endpoint}/days/${day.id}/close`, {
    headers,
    data: {
      revision: day.revision,
      actual_closing_cash: '3290',
      closing_bank_deposit: '500',
      difference_note: 'Counted shortage',
    },
  });
  expect(closed.ok()).toBeTruthy();
  await refresh();
  await expect(page.getByLabel('Cash kept in galla: ₹2,790', { exact: true })).toBeVisible();
  await expect(page.getByText('Expected cash · ₹2,800', { exact: true })).toBeVisible();
  await expect(page.getByText('Difference -₹10', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close day', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('hishob-closed.png') });
  await page.getByRole('button', { name: 'Day details & audit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
});

for (const mode of ['COUNTED', 'BILLING']) {
  test(`Hishob ${mode} keeps unknown balances distinct from saved sales`, async ({
    page,
  }, info) => {
    await login(page, 'Owner', '+9196' + String(Date.now()).slice(-8));
    await page.getByLabel('Shop name', { exact: true }).fill('Method review shop');
    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/shops'),
    );
    await page.getByRole('button', { name: 'Create shop', exact: true }).click();
    const response = await created;
    const shop = await response.json();
    const endpoint = `${response.url()}/${shop.id}`;
    const headers = { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' };
    expect(
      (
        await page.request.put(`${endpoint}/settings`, { headers, data: { hishob_mode: mode } })
      ).ok(),
    ).toBeTruthy();
    const started = await page.request.post(`${endpoint}/hishob/days`, {
      headers,
      data: { opening_cash: '1000' },
    });
    expect(started.ok()).toBeTruthy();
    const day = await started.json();
    await page.reload();
    await page.getByLabel('Hishob tab', { exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(
      page.getByLabel('Current galla: Available at closing', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('At closing', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`hishob-${mode}-open.png`) });
    const closed = await page.request.post(`${endpoint}/hishob/days/${day.id}/close`, {
      headers,
      data: {
        revision: day.revision,
        actual_closing_cash: '5000',
        closing_bank_deposit: '500',
        ...(mode === 'COUNTED'
          ? { digital_sales: '800' }
          : { billing_input: 'TOTAL', total_sales: '7000' }),
      },
    });
    expect(closed.ok()).toBeTruthy();
    await page.getByLabel('Home tab', { exact: true }).click();
    await page.getByLabel('Hishob tab', { exact: true }).click();
    await expect(page.getByLabel('Cash kept in galla: ₹4,500', { exact: true })).toBeVisible();
    await expect(
      page.getByText(mode === 'COUNTED' ? '₹4,800' : '₹7,000', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        mode === 'COUNTED'
          ? 'Cash sales are estimated; a cash difference cannot be independently checked.'
          : 'Cash difference unavailable without a payment breakdown.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('Difference ₹0', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`hishob-${mode}-closed.png`) });
  });
}
