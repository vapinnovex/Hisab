import { expect, Page } from '@playwright/test';
export const PASSWORD = 'a long test passphrase 42';
export const setupCodes = new Map<string, string>();

export async function newPassword(page: Page, password = PASSWORD) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
}
export async function finishLogin(
  page: Page,
  role: 'Owner' | 'Manager' | 'Worker',
  mobile: string,
) {
  const check = page.waitForResponse('**/api/auth/password/options');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const result = await check;
  expect(result.ok()).toBeTruthy();
  const { step } = await result.json();
  if (step === 'REGISTER') {
    await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Prajwal');
    await page
      .getByRole('textbox', { name: 'Email address', exact: true })
      .fill(`${mobile.replace(/\D/g, '')}@example.com`);
    await page.getByRole('button', { name: 'Send email code', exact: true }).click();
    await page.getByRole('textbox', { name: 'Email code', exact: true }).fill('123456');
    await newPassword(page);
    const verified = page.waitForResponse('**/api/auth/owner/register/confirm');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(await (await verified).json()).not.toHaveProperty('access_token');
  } else if (step === 'SETUP') {
    expect(setupCodes.has(mobile)).toBeTruthy();
    await page
      .getByRole('textbox', { name: 'Setup code', exact: true })
      .fill(setupCodes.get(mobile)!);
    await newPassword(page);
    await page.getByRole('button', { name: 'Set password & sign in', exact: true }).click();
  } else {
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
}
export async function login(page: Page, role: 'Owner' | 'Manager' | 'Worker', mobile: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Continue as ${role}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(mobile);
  await finishLogin(page, role, mobile);
}
