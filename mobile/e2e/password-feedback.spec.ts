import { expect, test } from '@playwright/test';

test('new passwords show live rules and estimated strength', async ({ page }, info) => {
  const mobile = '+9196' + String(Date.now()).slice(-8);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Owner', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(mobile);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Meter owner');
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill(`${mobile.slice(1)}@example.com`);
  await page.getByRole('button', { name: 'Send email code', exact: true }).click();
  await page.getByLabel('Email code', { exact: true }).fill('123456');
  const password = page.getByLabel('New password', { exact: true });
  const confirm = page.getByLabel('Confirm password', { exact: true });
  await expect(page.getByText('Password strength: Not entered', { exact: true })).toBeVisible();
  await password.fill('password123456');
  await confirm.fill('password123456');
  await expect(page.getByText('Password strength: Low', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Not met: Avoid common passwords and use at least 4 different characters', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(
    page.getByText('Complete the required fields above to continue.', { exact: true }),
  ).toBeVisible();
  await password.fill('Orchard!72836');
  await expect(page.getByText('Password strength: Medium', { exact: true })).toBeVisible();
  await password.fill(`orchard ${mobile.slice(1)} lantern`);
  await expect(
    page.getByLabel('Not met: Does not contain your mobile number or equal your email', {
      exact: true,
    }),
  ).toBeVisible();
  await password.fill('river lantern meadow cloud 83');
  await confirm.fill('river lantern meadow cloud 83');
  await expect(page.getByText('Password strength: High', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Passed: Passwords match', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('password-feedback.png'), fullPage: true });
  await password.fill(' river lantern meadow cloud 83');
  await expect(
    page.getByLabel('Not met: No spaces at the beginning or end', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Password strength: Low', { exact: true })).toBeVisible();
});

test('station serves its actual brand asset without horizontal overflow', async ({
  page,
}, info) => {
  await page.goto('http://localhost:8001/api/face-station/');
  const logo = page.getByRole('img', { name: 'Hishob logo', exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty('naturalWidth', 1254);
  await expect(page.getByRole('heading', { name: 'Connect your shop', exact: true })).toBeVisible();
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`station-${width}.png`), fullPage: true });
  }
});
