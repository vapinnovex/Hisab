import { expect, test } from '@playwright/test';
import { login, setupCodes } from './auth-helpers';

test('staff page, payments, purchases, notes, closing and private worker history', async ({
  browser,
}, info) => {
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const worker = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const suffix = String(Date.now()).slice(-8);
  const workerMobile = '+9197' + suffix;
  await login(owner, 'Owner', '+9198' + suffix);
  await owner.getByLabel('Shop name', { exact: true }).fill('Staff Payment Shop');
  const created = owner.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await owner.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  const endpoint = `${response.url()}/${shop.id}`;
  const headers = { Origin: new URL(owner.url()).origin, 'X-Hishob-Client': 'web' };
  await owner.getByRole('button', { name: 'Add worker', exact: true }).click();
  await owner.getByLabel('Worker name', { exact: true }).fill('Payment Asha');
  await owner.getByLabel('Mobile number', { exact: true }).fill(workerMobile);
  await owner.getByRole('switch', { name: 'Add salary now (optional)' }).check();
  await owner.getByLabel('Reference salary (₹)', { exact: true }).fill('15000');
  await expect(owner.getByLabel('Salary starts / joining date', { exact: true })).toHaveCount(0);
  const added = owner.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/workers'),
  );
  await owner.getByRole('button', { name: 'Add worker', exact: true }).click();
  const person = await (await added).json();
  await owner.getByLabel('Team tab', { exact: true }).click();
  await owner.getByRole('button', { name: 'Open profile · Payment Asha', exact: true }).click();
  for (const name of ['Attendance', 'Password access', 'Edit profile'])
    await expect(owner.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(owner.getByText('₹15,000 · Monthly', { exact: true })).toBeVisible();
  await owner.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(owner.getByText('Open Hishob first', { exact: true })).toBeVisible();
  await owner
    .getByRole('button', { name: /back/i })
    .or(owner.getByRole('link', { name: /back/i }))
    .click();
  await owner.getByRole('button', { name: 'Add dated note', exact: true }).click();
  await owner.getByLabel('Note', { exact: true }).fill('Discussed leave for a family visit');
  await owner.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(
    owner.getByText('Discussed leave for a family visit', { exact: true }),
  ).toBeVisible();
  const noDay = await owner.request.get(`${endpoint}/hishob/today`, { headers });
  expect((await noDay.json()).day).toBeNull();
  const opened = await owner.request.post(`${endpoint}/hishob/days`, {
    headers,
    data: { opening_cash: '10000' },
  });
  expect(opened.ok()).toBeTruthy();
  const day = await opened.json();
  for (const [kind, amount, note, method] of [
    ['Salary paid', '1000', 'First half salary', 'Cash'],
    ['Advance given', '500', 'Travel advance', 'Cash'],
    ['Money received', '100', 'Advance returned by UPI', 'UPI / bank'],
    ['Shop purchase · unpaid', '200', 'Groceries taken on credit', ''],
  ]) {
    await owner.getByRole('button', { name: 'Record payment', exact: true }).click();
    await owner.getByRole('button', { name: `Entry type: ${kind}`, exact: true }).click();
    await owner.getByLabel('Amount (₹)', { exact: true }).fill(amount);
    if (method)
      await owner.getByRole('button', { name: `Payment method: ${method}`, exact: true }).click();
    await owner.getByLabel('What was this for?', { exact: true }).fill(note);
    await owner.getByRole('button', { name: 'Save payment', exact: true }).click();
    await expect(owner.getByText(note, { exact: true })).toBeVisible();
  }
  await owner.getByRole('button', { name: 'Receive purchase payment', exact: true }).click();
  await owner.getByLabel('Amount (₹)', { exact: true }).fill('50');
  await owner.getByLabel('What was this for?', { exact: true }).fill('Part payment for groceries');
  await owner.getByRole('button', { name: 'Save payment', exact: true }).click();
  await expect(owner.getByText('Purchase due: ₹150', { exact: true })).toBeVisible();
  const saved = await owner.request.get(`${endpoint}/hishob/days/${day.id}`, { headers });
  const cashbook = await saved.json();
  expect(cashbook.transactions).toHaveLength(5);
  expect(cashbook.expected_closing_cash).toBe('8550.00');
  expect(cashbook.digital_other_in).toBe('100.00');
  expect(cashbook.credit_sales).toBe('150.00');
  await owner.getByText('REFERENCE SALARY', { exact: true }).scrollIntoViewIfNeeded();
  await owner.screenshot({
    path: info.outputPath('staff-payment-book-mobile.png'),
    fullPage: true,
  });
  await owner
    .getByText('Travel advance', { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Cancel record', exact: true })
    .click();
  await owner.getByLabel('Correction reason', { exact: true }).fill('Advance entered by mistake');
  await owner.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(
    owner.getByText('Cancelled · Advance entered by mistake', { exact: true }),
  ).toBeVisible();
  const corrected = await owner.request.get(`${endpoint}/hishob/days/${day.id}`, { headers });
  expect((await corrected.json()).expected_closing_cash).toBe('9050.00');
  await owner.getByRole('button', { name: 'Edit reference salary', exact: true }).click();
  await owner.getByLabel('Reference salary (₹)', { exact: true }).fill('16000');
  await owner.getByLabel('Reason for change', { exact: true }).fill('Agreed new reference amount');
  await owner.getByRole('button', { name: 'Save reference salary', exact: true }).click();
  await expect(owner.getByText('₹16,000 · Monthly', { exact: true })).toBeVisible();
  await owner.getByLabel('Hishob tab', { exact: true }).click();
  await owner.getByRole('button', { name: 'Close day', exact: true }).click();
  await expect(owner.getByText('Staff payments today', { exact: true })).toBeVisible();
  await expect(
    owner
      .getByText('Staff payments today', { exact: true })
      .locator('..')
      .getByText('First half salary', { exact: true }),
  ).toBeVisible();
  await owner.screenshot({ path: info.outputPath('staff-closing-review.png'), fullPage: true });
  const grant = await owner.request.post(`${endpoint}/team/${person.id}/password-access`, {
    headers,
  });
  expect(grant.ok()).toBeTruthy();
  setupCodes.set(workerMobile, (await grant.json()).setup_code);
  await login(worker, 'Worker', workerMobile);
  await worker.getByRole('button', { name: 'Open my record', exact: true }).click();
  await expect(worker.getByText('₹16,000 · Monthly', { exact: true })).toBeVisible();
  await expect(worker.getByText('First half salary', { exact: true })).toBeVisible();
  await expect(
    worker.getByText('Discussed leave for a family visit', { exact: true }),
  ).toBeVisible();
  for (const name of [
    'Record payment',
    'Add dated note',
    'Cancel record',
    'Edit reference salary',
    'Receive purchase payment',
    'Calculate salary',
  ])
    await expect(worker.getByRole('button', { name, exact: true })).toHaveCount(0);
  await worker.setViewportSize({ width: 320, height: 800 });
  await expect(worker.locator('body')).toHaveJSProperty('scrollWidth', 320);
  await worker.screenshot({
    path: info.outputPath('worker-payment-book-mobile.png'),
    fullPage: true,
  });
  await owner.close();
  await worker.close();
});

test('uncertain staff payment save is recovered without posting twice', async ({ page }) => {
  const suffix = String(Date.now()).slice(-8);
  await login(page, 'Owner', '+9196' + suffix);
  await page.getByLabel('Shop name', { exact: true }).fill('Recovery Shop');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  const endpoint = `${response.url()}/${shop.id}`;
  const headers = { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' };
  await page.request.post(`${endpoint}/workers`, {
    headers,
    data: { name: 'Recovery Worker', mobile: '+9195' + suffix },
  });
  await page.request.post(`${endpoint}/hishob/days`, { headers, data: { opening_cash: '1000' } });
  await page.getByLabel('Team tab', { exact: true }).click();
  await page.getByRole('button', { name: 'Open profile · Recovery Worker', exact: true }).click();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByLabel('Amount (₹)', { exact: true }).fill('100');
  await page.getByLabel('What was this for?', { exact: true }).fill('Recovery payment');
  await page.route(
    '**/staff/*/payments',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Save payment', exact: true }).click();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await expect(page.getByText('Recovery payment', { exact: true })).toBeVisible();
  const day = (await (await page.request.get(`${endpoint}/hishob/today`, { headers })).json()).day;
  expect(day.transactions).toHaveLength(1);
  expect(day.expected_closing_cash).toBe('900.00');
});
