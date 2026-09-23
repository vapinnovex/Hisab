import { expect, test, Page } from '@playwright/test';

async function login(page: Page, role: 'Owner' | 'Manager' | 'Worker', mobile: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Continue as ${role}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(mobile);
  await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  await page.getByRole('textbox', { name: 'OTP code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
}
async function back(page: Page) {
  await page
    .getByRole('button', { name: /back/i })
    .or(page.getByRole('link', { name: /back/i }))
    .click();
}
async function addPerson(page: Page, kind: 'worker' | 'manager', name: string, mobile: string) {
  await page.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
  await page
    .getByRole('textbox', { name: kind === 'worker' ? 'Worker name' : 'Manager name', exact: true })
    .fill(name);
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(mobile);
  await page.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
}

test('owner-managed attendance, manager permissions, and worker monthly calendar', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const manager = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const worker = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const suffix = String(Date.now()).slice(-8);
  const errors: string[] = [];
  for (const page of [owner, manager, worker])
    page.on('pageerror', (error) => errors.push(error.message));
  await login(owner, 'Owner', '+9198' + suffix);
  await owner.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Hisab Test Store');
  await owner.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(owner.getByText('Hisab Test Store', { exact: true })).toBeVisible();
  await addPerson(owner, 'worker', 'Asha', '+9197' + suffix);
  await owner.getByRole('button', { name: 'Manage managers', exact: true }).click();
  await addPerson(owner, 'manager', 'Ravi', '+9196' + suffix);
  await expect(owner.getByText('Ravi', { exact: true })).toBeVisible();
  await back(owner);
  await owner.getByRole('button', { name: 'View today’s attendance', exact: true }).click();
  await owner.getByRole('button', { name: 'Mark in · Asha', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Mark in · Asha', exact: true })).toHaveCount(0);
  await expect(owner.getByRole('button', { name: 'Mark out · Asha', exact: true })).toHaveCount(0);
  await login(worker, 'Worker', '+9197' + suffix);
  await expect(worker.getByText('Hello, Asha', { exact: true })).toBeVisible();
  await expect(worker.getByRole('button', { name: 'Check In', exact: true })).toHaveCount(0);
  await expect(worker.getByRole('button', { name: 'Check Out', exact: true })).toHaveCount(0);
  await worker.getByRole('button', { name: 'My attendance', exact: true }).click();
  await expect(worker.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}, Present$/ })).toBeVisible();
  await login(manager, 'Manager', '+9196' + suffix);
  await expect(manager.getByText('MANAGER’S DESK', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Shop settings', exact: true })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Manage workers', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Add worker', exact: true })).toHaveCount(0);
  await back(owner);
  await owner.getByRole('button', { name: 'Shop settings', exact: true }).click();
  await owner.getByRole('button', { name: 'Check-in and check-out', exact: true }).click();
  await owner.getByRole('switch', { name: 'Managers can add workers', exact: true }).click();
  await owner
    .getByRole('switch', { name: 'Managers can edit and deactivate workers', exact: true })
    .click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(owner.getByText('Shop settings saved.', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Add worker', exact: true })).toBeVisible();
  await addPerson(manager, 'worker', 'Manoj', '+9195' + suffix);
  await expect(manager.getByText('Manoj', { exact: true })).toBeVisible();
  await back(manager);
  await manager.getByRole('button', { name: 'View today’s attendance', exact: true }).click();
  await manager.getByRole('button', { name: 'Mark in · Manoj', exact: true }).click();
  await manager.getByRole('button', { name: 'Mark out · Manoj', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Mark out · Manoj', exact: true })).toHaveCount(
    0,
  );
  await manager.getByRole('button', { name: 'Update / history · Asha', exact: true }).click();
  await manager.getByRole('button', { name: /^Update \d{4}-/ }).click();
  await manager.getByRole('button', { name: 'Half day', exact: true }).click();
  await manager
    .getByRole('textbox', { name: 'Attendance note', exact: true })
    .fill('Left after lunch');
  await manager.getByRole('button', { name: 'Save attendance', exact: true }).click();
  await expect(worker.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}, Half day$/ })).toBeVisible();
  await expect(worker.getByText('Left after lunch', { exact: true })).toBeVisible();
  await worker.screenshot({ path: testInfo.outputPath('worker-calendar.png'), fullPage: true });
  await owner.screenshot({ path: testInfo.outputPath('shop-settings.png'), fullPage: true });
  await worker.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(
    worker.getByText('No attendance days in this month.', { exact: true }),
  ).toBeVisible();
  await worker.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(worker.getByText('Left after lunch', { exact: true })).toBeVisible();
  // Permission changes apply to existing sessions without requiring a new login.
  await owner
    .getByRole('switch', { name: 'Managers can record and correct attendance', exact: true })
    .click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(manager.getByRole('button', { name: /^Update \d{4}-/ })).toHaveCount(0);
  await owner
    .getByRole('switch', { name: 'Workers can view their own attendance', exact: true })
    .click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(worker.getByText('Attendance viewing is off', { exact: true })).toBeVisible();
  await owner
    .getByRole('switch', { name: 'Workers can view their own attendance', exact: true })
    .click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(worker.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}, Half day$/ })).toBeVisible();
  await back(worker);
  await worker.getByRole('button', { name: 'My profile', exact: true }).click();
  await worker.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    worker.getByRole('button', { name: 'Continue as Worker', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await owner.close();
  await manager.close();
  await worker.close();
});

for (const role of ['Worker', 'Manager'] as const) {
  test(`unadded ${role.toLowerCase()} cannot log in`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: `Continue as ${role}`, exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Mobile number', exact: true })
      .fill('+9194' + String(Date.now()).slice(-8));
    await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
    await expect(
      page.getByText('You haven’t been added to any shop yet. Ask your shop owner to add you.', {
        exact: true,
      }),
    ).toBeVisible();
  });
}
