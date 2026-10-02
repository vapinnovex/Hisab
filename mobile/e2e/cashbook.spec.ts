import { login } from './auth-helpers';
import { expect, test, Page } from '@playwright/test';

async function owner(page: Page) {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Daily Hishob Shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await page.getByLabel('Hishob tab', { exact: true }).click();
}
async function method(page: Page, label: string) {
  await page.getByRole('button', { name: 'Choose Hishob method', exact: true }).click();
  await page.getByRole('button', { name: `Hishob method: ${label}`, exact: true }).click();
  await page.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(page.getByText('Shop settings saved.', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
}
async function expense(
  page: Page,
  payment: 'Cash from galla' | 'UPI / bank / card',
  amount: string,
) {
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Transaction type: Cash sales', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: `Paid from: ${payment}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill(amount);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Shop supplies');
  await page.getByRole('textbox', { name: 'Category (optional)', exact: true }).fill('Supplies');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
}

async function unpaid(page: Page, amount: string) {
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page
    .getByRole('button', { name: 'Transaction type: Credit sales (unpaid)', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Customer name / bill reference', exact: true })
    .fill('Ravi');
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill(amount);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Unpaid bill');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
}

test('cash-count shop estimates sales, excludes digital expenses and carries retained cash', async ({
  page,
}, info) => {
  await owner(page);
  await method(page, 'Count cash');
  await expense(page, 'Cash from galla', '500');
  await expense(page, 'UPI / bank / card', '300');
  await unpaid(page, '300');
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('2000');
  await expect(page.getByText('Today’s unpaid sales · ₹300', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('5500');
  await expect(page.getByText('Estimated cash sales · ₹5,000', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Cash removed for bank at closing', exact: true })
    .fill('3000');
  await page.getByRole('textbox', { name: 'Cash taken home at closing', exact: true }).fill('500');
  await expect(page.getByText('Cash kept for next day · ₹2,000', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Difference note', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('count-cash-close.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(
    page.getByText('Sales ₹7,300 · includes estimated cash sales', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('CASH KEPT IN GALLA', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  await expect(page.getByText('Monthly sales · ₹7,300', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Recorded sales ₹2,300 · Estimated cash sales ₹5,000', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('history-summary.png'), fullPage: true });
  await page.getByRole('button', { name: 'View monthly breakdown', exact: true }).click();
  await expect(
    page.getByText('Recorded sales ₹2,300 · Estimated cash sales ₹5,000', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('monthly-sales.png'), fullPage: true });
});

test('billing shop reconciles cash only and safely corrects a preserved closing', async ({
  page,
}) => {
  await owner(page);
  await method(page, 'Use billing totals');
  await expense(page, 'Cash from galla', '500');
  await expense(page, 'UPI / bank / card', '300');
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByRole('textbox', { name: 'Total sales from billing', exact: true }).fill('7000');
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('2000');
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('5400');
  await expect(page.getByLabel('Difference -₹100', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Cash removed for bank at closing', exact: true })
    .fill('6000');
  await expect(
    page.getByRole('button', { name: 'Close today’s Hishob', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Reduce bank/home withdrawals: they exceed the cash counted.' })
      .first(),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Cash removed for bank at closing', exact: true })
    .fill('2000');
  await page
    .getByRole('textbox', { name: 'Difference note', exact: true })
    .fill('Counted shortage');
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(page.getByLabel('Difference -₹100', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen day', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reopening reason', exact: true }).fill('Cash recounted');
  await page.getByRole('button', { name: 'Confirm reopening', exact: true }).click();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Total sales from billing', exact: true }),
  ).toHaveValue('7,000.00');
  await expect(page.getByRole('textbox', { name: 'UPI / card sales', exact: true })).toHaveValue(
    '2,000.00',
  );
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('5500');
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View closing 2', exact: true })).toBeVisible();
  await expect(
    page.getByText('Sales ₹7,000', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});

test('total-only billing saves unknown payment split and can later reconcile known payments', async ({
  page,
}, info) => {
  await owner(page);
  await method(page, 'Use billing totals');
  await expect(page.getByText('CURRENT GALLA', { exact: true })).toBeVisible();
  await expect(page.getByText('Available at closing', { exact: true })).toBeVisible();
  await expense(page, 'Cash from galla', '500');
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Non-cash sales: Not known', exact: true }).click();
  await page.getByRole('textbox', { name: 'Total sales from billing', exact: true }).fill('7000');
  await expect(
    page.getByRole('textbox', { name: 'Cash sales from billing', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'UPI / card sales', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('5400');
  await page
    .getByRole('textbox', { name: 'Cash removed for bank at closing', exact: true })
    .fill('2000');
  await expect(page.getByRole('textbox', { name: 'Difference note', exact: true })).toHaveCount(0);
  await page
    .getByText('Use billing totals', { exact: true })
    .filter({ visible: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('total-only-billing.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(
    page.getByText('Sales ₹7,000', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText('CASH KEPT IN GALLA', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Payment breakdown not provided/).filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  await expect(page.getByText('Monthly sales · ₹7,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View monthly breakdown', exact: true }).click();
  await expect(page.getByText(/Sales without payment breakdown · ₹7,000/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('total-only-monthly.png'), fullPage: true });
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
  await page.getByRole('button', { name: 'Day details & audit', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen day', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reopening reason', exact: true })
    .fill('Received digital sales totals');
  await page.getByRole('button', { name: 'Confirm reopening', exact: true }).click();
  await expect(page.getByText('CURRENT GALLA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Total sales from billing', exact: true }),
  ).toHaveValue('7,000.00');
  await page
    .getByRole('button', { name: 'Non-cash sales: I know the totals', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('8000');
  await expect(
    page.getByRole('textbox', { name: 'Credit sales still unpaid', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Close today’s Hishob', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: 'Check billing total and UPI/card sales: payments cannot exceed total sales.',
      })
      .first(),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('2000');
  await expect(page.getByText('Calculated cash sales · ₹5,000', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Difference -₹100', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Difference note', exact: true }).fill('Cash shortage');
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(page.getByLabel('Difference -₹100', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Sales ₹7,000', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View closing 1', exact: true }).click();
  await expect(
    page.getByText(/Payment breakdown not provided/).filter({ visible: true }),
  ).toBeVisible();
});

test('opening cash follows refreshed carry-forward without overwriting an owner edit', async ({
  page,
}, info) => {
  let suggested = '5999.00';
  let reads = 0;
  await page.route('**/api/shops/*/hishob/today', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, suggested_opening_cash: suggested, previous_closed_date: '2026-09-26' },
    });
    reads++;
  });
  await owner(page);
  const opening = page.getByRole('textbox', { name: 'Opening cash', exact: true });
  const reason = page.getByRole('textbox', { name: 'Opening change reason', exact: true });
  await expect(opening).toHaveValue('5,999.00');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByText(/₹5,999 carried from/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start today’s Hishob', exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath('hishob-carried-opening.png') });
  suggested = '1499.00';
  await expect(opening).toHaveValue('1,499.00');
  await expect(reason).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Start today’s Hishob', exact: true }),
  ).toBeEnabled();

  await opening.fill('1200');
  await reason.fill('Counted opening cash');
  const previousReads = reads;
  suggested = '1400.00';
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(opening).toHaveValue('1,200');
  await expect(reason).toHaveValue('Counted opening cash');
  await page
    .getByRole('button', { name: 'Start today’s Hishob', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('hishob-opening-adjustment.png') });
});

test('customer dues collect partial cash and digital payments and feed billing close', async ({
  page,
}, info) => {
  await owner(page);
  await method(page, 'Use billing totals');
  await page.getByRole('button', { name: 'Customer dues', exact: true }).click();
  await page.getByRole('button', { name: 'Add unpaid sale', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Customer name / bill reference', exact: true })
    .fill('Ravi');
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill('1000');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Bill 42');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByText('Due ₹1,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Receive payment · Ravi', exact: true }).click();
  await page.getByRole('textbox', { name: 'Payment received (₹)', exact: true }).fill('1100');
  await expect(
    page.getByRole('button', { name: 'Confirm payment received', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Payment cannot exceed the remaining due.' }).first(),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Payment received (₹)', exact: true }).fill('300');
  await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
  await expect(page.getByText('Due ₹700', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Receive payment · Ravi', exact: true }).click();
  await page.getByRole('textbox', { name: 'Payment received (₹)', exact: true }).fill('200');
  await page.getByRole('button', { name: 'Received by: UPI / card / bank', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Payment note (optional)', exact: true })
    .fill('UPI ref 123');
  await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
  await expect(page.getByText('Due ₹500', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Payment history · Ravi', exact: true }).click();
  await expect(page.getByText('UPI ref 123', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('customer-dues.png'), fullPage: true });
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'UPI / card sales', exact: true })).toBeVisible();
  await expect(page.getByText('Today’s unpaid sales · ₹500', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Billing report: Payment breakdown', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Total sales from billing', exact: true }).fill('1000');
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('200');
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('1300');
  await expect(page.getByLabel('Difference ₹0', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('simplified-billing-close.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(
    page.getByText('Sales ₹1,000', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});
