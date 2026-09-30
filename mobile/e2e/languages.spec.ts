import { expect, test } from '@playwright/test';
import hi from '../src/locales/hi.json';
import mr from '../src/locales/mr.json';
import { login, PASSWORD } from './auth-helpers';

for (const [language, name, catalog] of [
  ['hi', 'हिंदी', hi],
  ['mr', 'मराठी', mr],
] as const) {
  test(`registration and API errors use ${language}`, async ({ page }) => {
    const text = (key: string) => (catalog as Record<string, string>)[key] || key;
    await page.goto('/');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await page
      .getByRole('button', {
        name: text('Continue as {0}').replace('{0}', text('Owner')),
        exact: true,
      })
      .click();
    await page
      .getByRole('textbox', { name: text('Mobile number'), exact: true })
      .fill('+9198' + String(Date.now()).slice(-8));
    await page.getByRole('button', { name: text('Continue'), exact: true }).click();
    await page.getByRole('textbox', { name: text('Your name'), exact: true }).fill('Original name');
    await page
      .getByRole('textbox', { name: text('Email address'), exact: true })
      .fill(`locale${Date.now()}@example.com`);
    const registration = page.waitForResponse('**/api/auth/owner/register/request');
    await page.getByRole('button', { name: text('Send email code'), exact: true }).click();
    const response = await registration;
    expect(response.request().postDataJSON().language).toBe(language);
    expect(response.request().headers()['accept-language']).toBe(language);
    await page.getByRole('textbox', { name: text('Email code'), exact: true }).fill('000000');
    await page.getByLabel(text('New password'), { exact: true }).fill(PASSWORD);
    await page.getByLabel(text('Confirm password'), { exact: true }).fill(PASSWORD);
    const confirmation = page.waitForResponse('**/api/auth/owner/register/confirm');
    await page.getByRole('button', { name: text('Create account'), exact: true }).click();
    const invalid = await confirmation;
    expect(invalid.status()).toBe(400);
    expect(invalid.headers()['content-language']).toBe(language);
    await expect(
      page.getByRole('alert').filter({ hasText: (await invalid.json()).detail }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: text('Email code'), exact: true }).fill('123456');
    await page.getByRole('button', { name: text('Create account'), exact: true }).click();
    await expect(page.getByRole('textbox', { name: text('Shop name'), exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: text('Shop name'), exact: true })).toBeVisible();
  });
}

test('personal language overrides shop default and translated financial help works', async ({
  page,
}) => {
  await login(page, 'Owner', '+9197' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Unchanged shop');
  await page.getByRole('button', { name: 'मराठी', exact: true }).click();
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  // English registration preference overrides Marathi shop default.
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('button', { name: 'हिंदी', exact: true }).click();
  await page.getByRole('button', { name: 'Save language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.getByLabel(hi['{0} tab'].replace('{0}', hi.Hishob), { exact: true }).click();
  await page
    .getByRole('button', { name: hi['About {0}'].replace('{0}', hi['Opening cash']), exact: true })
    .click();
  await expect(
    page.getByText(
      hi[
        'Count the cash already in the drawer before today’s sales. Normally this is the cash kept after the previous closing. Example: yesterday you kept ₹1,500, so today opens with ₹1,500. A past shortage is not deducted a second time. Give a reason only if you change the carried amount.'
      ],
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: hi['Open account'], exact: true }).click();
  await page.getByRole('button', { name: hi.Language, exact: true }).click();
  await page.getByRole('button', { name: hi['Use shop default'], exact: true }).click();
  await page.getByRole('button', { name: hi['Save language'], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
  await expect(page.getByText('Unchanged shop', { exact: true }).first()).toBeVisible();
});
