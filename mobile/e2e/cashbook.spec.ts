import { expect, test, Page } from '@playwright/test';

async function owner(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Owner', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Mobile number', exact: true })
    .fill('+9188' + String(Date.now()).slice(-8));
  await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  await page.getByRole('textbox', { name: 'OTP code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Shop owner');
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

test('cash-count shop estimates sales, excludes digital expenses and carries retained cash', async ({
  page,
}, info) => {
  await owner(page);
  await method(page, 'Count cash');
  await expense(page, 'Cash from galla', '500');
  await expense(page, 'UPI / bank / card', '300');
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('2000');
  await page.getByRole('textbox', { name: 'Credit sales still unpaid', exact: true }).fill('300');
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
  await page.getByRole('textbox', { name: 'Cash sales from billing', exact: true }).fill('5000');
  await page.getByRole('textbox', { name: 'UPI / card sales', exact: true }).fill('2000');
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('5400');
  await expect(page.getByLabel('Difference -₹100', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Cash removed for bank at closing', exact: true })
    .fill('6000');
  await expect(
    page.getByRole('button', { name: 'Close today’s Hishob', exact: true }),
  ).toBeDisabled();
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
    page.getByRole('textbox', { name: 'Cash sales from billing', exact: true }),
  ).toHaveValue('5,000.00');
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
  await page.getByRole('button', { name: 'Billing report: Total sales only', exact: true }).click();
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
  await page.getByRole('textbox', { name: 'Credit sales still unpaid', exact: true }).fill('0');
  await expect(
    page.getByRole('button', { name: 'Close today’s Hishob', exact: true }),
  ).toBeDisabled();
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
