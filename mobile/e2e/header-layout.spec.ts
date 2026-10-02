import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

for (const width of [320, 390, 1440]) {
  test(`headers stay aligned and controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, 'Owner', '+9196' + String(Date.now()).slice(-8));
    await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Header test shop');
    await page.getByRole('button', { name: 'Create shop', exact: true }).click();
    await page.getByLabel('Team tab', { exact: true }).click();
    const account = page.getByRole('button', { name: 'Open account', exact: true });
    await expect(account).toBeVisible();
    const root = (await account.boundingBox())!;
    await page.getByRole('button', { name: 'Add worker', exact: true }).click();
    const back = page.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeVisible();
    const nested = (await account.boundingBox())!;
    const backBox = (await back.boundingBox())!;
    expect(Math.abs(nested.x + nested.width - (root.x + root.width))).toBeLessThan(2);
    expect(nested.x + nested.width).toBeLessThanOrEqual(width - 16);
    expect(backBox.x).toBeGreaterThanOrEqual(16);
    expect(backBox.x + backBox.width).toBeLessThan(nested.x);
    await page.screenshot({ path: test.info().outputPath(`header-${width}.png`) });
    await back.click();
    await expect(page.getByRole('button', { name: 'Add worker', exact: true })).toBeVisible();
    await account.click();
    await expect(page.getByRole('button', { name: 'Language', exact: true })).toBeVisible();
  });
}
