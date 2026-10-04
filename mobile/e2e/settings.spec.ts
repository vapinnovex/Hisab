import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

test('shop settings rename, discard, dependent permissions and retry work on a small screen', async ({
  page,
}, info) => {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Settings test shop');
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  const endpoint = `${response.url()}/${shop.id}/settings`;
  await page.getByRole('button', { name: 'Shop settings', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save shop settings', exact: true });
  const name = page.getByRole('textbox', { name: 'Shop name', exact: true });
  const closing = page.getByRole('switch', { name: 'Managers can close Hishob', exact: true });
  const access = page.getByRole('switch', { name: 'Managers can access Hishob', exact: true });
  await expect(save).toBeDisabled();
  await name.fill('X');
  await expect(save).toBeDisabled();
  await name.fill('Market Road Store');
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(name).toHaveValue('Settings test shop');
  await expect(save).toBeDisabled();
  await expect(closing).toBeDisabled();
  await access.click();
  await expect(closing).toBeEnabled();
  await closing.click();
  await name.fill('Market Road Store');
  await page.getByRole('button', { name: 'Hishob method: Count cash', exact: true }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .getByText('Shop settings', { exact: true })
      .filter({ visible: true })
      .scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await access.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('settings-permissions-320.png') });
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({ status: 503, json: { detail: 'Settings temporarily unavailable' } });
    else await route.continue();
  });
  await save.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The server could not confirm this change.' }),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(name).toHaveValue('Market Road Store');
  await page.unroute(endpoint);
  await save.click();
  await expect(page.getByText('Shop settings saved.', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.hishob_mode).toBe('COUNTED');
  expect(saved.manager_can_access_hishob).toBe(true);
  expect(saved.manager_can_close_hishob).toBe(true);
  await name.fill('Temporary change');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(name).toHaveValue('Market Road Store');
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
  await expect(page.getByText('Market Road Store', { exact: true })).toBeVisible();
});

test('attendance can be disabled and restored, and support contacts are available', async ({
  page,
}) => {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Optional attendance shop');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Attendance tab' })).toBeVisible();
  await page.getByRole('button', { name: 'Shop settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manual attendance', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Face scan', exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Enable attendance', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Face scan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(page.getByText('Shop settings saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Attendance tab' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Enable attendance', exact: true }).click();
  await page.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Attendance tab' })).toBeVisible();
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Help & support', exact: true }).click();
  await expect(page.getByText('+91 90224 45933', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Email support is not active yet. Please use the phone number above.', {
      exact: true,
    }),
  ).toBeVisible();
});
