import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

test('Hishob explains transaction choices without changing entered amounts', async ({
  page,
}, info) => {
  await login(page, 'Owner', '+9191' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Guided shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await page.getByLabel('Hishob tab', { exact: true }).click();
  await page.getByRole('button', { name: 'About Opening cash', exact: true }).click();
  await expect(page.getByText(/A past shortage is not deducted a second time/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('1500');
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  await page.getByRole('button', { name: 'About Close day', exact: true }).click();
  await expect(page.getByText(/Closing saves a snapshot and locks the day/)).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page
    .getByRole('button', { name: 'Transaction type: Supplier payment', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill('250');
  await page.getByRole('button', { name: 'About Supplier payment', exact: true }).click();
  await expect(page.getByText(/Do not also enter the same payment as an expense/)).toBeVisible();
  await page.getByRole('button', { name: 'About Paid from', exact: true }).click();
  await expect(page.getByText(/physical money left the drawer/)).toBeVisible();
  await page.getByRole('button', { name: 'About Category (optional)', exact: true }).click();
  await expect(page.getByText(/this label does not/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount (₹)', exact: true })).toHaveValue('250');
  await page.screenshot({ path: info.outputPath('transaction-help.png'), fullPage: true });
});

test('team register browses past dates, filters and returns to today', async ({ page }, info) => {
  await login(page, 'Owner', '+9192' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Calendar shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await page.getByRole('button', { name: 'Add worker', exact: true }).click();
  await page.getByRole('textbox', { name: 'Worker name', exact: true }).fill('Asha');
  await page
    .getByRole('textbox', { name: 'Mobile number', exact: true })
    .fill('+9193' + String(Date.now()).slice(-8));
  await page.getByRole('button', { name: 'Add worker', exact: true }).click();
  await page.getByLabel('Attendance tab', { exact: true }).click();
  await page.getByRole('button', { name: 'Mark in · Asha', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Present, 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Choose attendance date', exact: true }).click();
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const previous = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  previous.setUTCDate(0);
  const date = previous.toISOString().slice(0, 10);
  // Calendar labels also include the day's attendance summary for screen readers.
  await page.getByRole('button', { name: new RegExp(`^Team attendance ${date},`) }).click();
  await expect(
    page.getByText('No eligible team members or recorded attendance for this date.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Everyone, 0', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark in · Asha', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to today', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Present, 1', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('team-calendar.png'), fullPage: true });
  await page.getByRole('button', { name: 'Update / history · Asha', exact: true }).click();
  await expect(page.getByRole('button', { name: `Update ${today}`, exact: true })).toBeVisible();
});
