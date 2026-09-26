import { expect, test, Page } from '@playwright/test';

import { login, finishLogin, setupCodes, PASSWORD } from './auth-helpers';

async function tab(page: Page, name: string) {
  await page.getByLabel(`${name} tab`, { exact: true }).click();
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
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/${kind === 'worker' ? 'workers' : 'managers'}`),
  );
  await page.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
  const response = await created;
  const person = await response.json();
  const endpoint = response
    .url()
    .replace(/\/(workers|managers)$/, `/team/${person.id}/password-access`);
  const grant = await page.request.post(endpoint, {
    headers: { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' },
  });
  expect(grant.ok()).toBeTruthy();
  setupCodes.set(mobile, (await grant.json()).setup_code);
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
  await owner.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Hishob Test Store');
  await owner.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(owner.getByText('Hishob Test Store', { exact: true })).toBeVisible();
  await expect(owner.getByLabel('Home tab', { exact: true })).toBeVisible();
  await expect(owner.getByLabel('Register tab', { exact: true })).toBeVisible();
  await expect(owner.getByLabel('Team tab', { exact: true })).toBeVisible();
  await expect(owner.getByLabel('Account tab', { exact: true })).toBeVisible();
  for (const label of ['Home', 'Register', 'Team', 'Account']) {
    const bounds = await owner
      .getByLabel(`${label} tab`, { exact: true })
      .getByText(label, { exact: true })
      .boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  }
  await owner.screenshot({ path: testInfo.outputPath('owner-home.png'), fullPage: true });
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
  await tab(manager, 'My day');
  await expect(manager.getByRole('button', { name: 'Mark my arrival', exact: true })).toHaveCount(
    0,
  );
  await expect(
    manager.getByText(
      'Your owner records your attendance. They can enable self-marking in Shop settings.',
      { exact: true },
    ),
  ).toBeVisible();
  await tab(manager, 'Home');
  await expect(manager.getByText('MANAGER’S DESK', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Shop settings', exact: true })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Manage workers', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Add worker', exact: true })).toHaveCount(0);
  await expect(
    manager.getByRole('button', { name: 'Attendance · Ravi', exact: true }),
  ).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Edit Ravi', exact: true })).toHaveCount(0);
  await tab(owner, 'Account');
  await owner.getByRole('button', { name: 'Shop settings', exact: true }).click();
  await owner.getByRole('button', { name: 'Check-in and check-out', exact: true }).click();
  await owner
    .getByRole('switch', { name: 'Managers can mark their own attendance', exact: true })
    .click();
  await owner.getByRole('switch', { name: 'Managers can add workers', exact: true }).click();
  await owner
    .getByRole('switch', { name: 'Managers can edit and deactivate workers', exact: true })
    .click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(owner.getByText('Shop settings saved.', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Add worker', exact: true })).toBeVisible();
  await addPerson(manager, 'worker', 'Manoj', '+9195' + suffix);
  await expect(manager.getByText('Manoj', { exact: true })).toBeVisible();
  await tab(manager, 'Home');
  await manager.getByRole('button', { name: 'View today’s attendance', exact: true }).click();
  await manager.getByRole('button', { name: 'Mark in · Manoj', exact: true }).click();
  await manager.getByRole('button', { name: 'Mark out · Manoj', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Mark out · Manoj', exact: true })).toHaveCount(
    0,
  );
  await tab(manager, 'My day');
  await expect(manager.getByRole('button', { name: 'Mark my arrival', exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Mark my arrival', exact: true }).click();
  await manager.getByRole('button', { name: 'Mark my departure', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Mark my departure', exact: true })).toHaveCount(
    0,
  );
  await expect(manager.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}, Present$/ })).toBeVisible();
  await manager.screenshot({ path: testInfo.outputPath('manager-my-day.png'), fullPage: true });
  await tab(manager, 'Register');
  await expect(
    manager.getByRole('button', { name: 'Update / history · Ravi', exact: true }),
  ).toHaveCount(0);
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
  const replacementWorker = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(replacementWorker, 'Worker', '+9197' + suffix);
  await expect(replacementWorker.getByText('Hello, Asha', { exact: true })).toBeVisible();
  await expect(
    worker.getByRole('button', { name: 'Continue as Worker', exact: true }),
  ).toBeVisible();
  await tab(replacementWorker, 'Account');
  await replacementWorker.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    replacementWorker.getByRole('button', { name: 'Continue as Worker', exact: true }),
  ).toBeVisible();
  await replacementWorker.close();
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
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByText('You haven’t been added to any shop yet. Ask your shop owner to add you.', {
        exact: true,
      }),
    ).toBeVisible();
  });
}

test('Hishob branding and role choices adapt to a small phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Hishob logo', exact: true })).toBeVisible();
  for (const role of ['Owner', 'Manager', 'Worker'])
    await expect(
      page.getByRole('button', { name: `Continue as ${role}`, exact: true }),
    ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('hishob-welcome.png'), fullPage: true });
});

test('team search, attendance filters and header shop switching', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const suffix = String(Date.now()).slice(-8);
  await login(page, 'Owner', '+9193' + suffix);
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Market Road');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByRole('button', { name: /Switch shop, current shop:/ })).toHaveCount(0);
  await expect(page.getByText(/team members marked today/)).toHaveCount(0);
  await addPerson(page, 'worker', 'Asha', '+9192' + suffix);
  await page.getByRole('button', { name: 'Manage managers', exact: true }).click();
  await addPerson(page, 'manager', 'Ravi', '+9191' + suffix);
  await back(page);
  await tab(page, 'Team');
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Team role: Managers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Team role: Everyone', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search team', exact: true }).fill('aSH');
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search team', exact: true }).fill('+91 91' + suffix);
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search team', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('team-directory.png') });
  await tab(page, 'Register');
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Not marked, 2', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Absent, 0', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mark in · Asha', exact: true }).click();
  await page.getByRole('button', { name: 'Update / history · Ravi', exact: true }).click();
  await page.getByRole('button', { name: /^Update \d{4}-/ }).click();
  await page.getByRole('button', { name: 'Absent', exact: true }).click();
  await page.getByRole('button', { name: 'Save attendance', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save attendance', exact: true })).toHaveCount(0);
  await back(page);
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Present, 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Attendance filter: Absent, 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Update / history · Ravi', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Update / history · Asha', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search register', exact: true }).fill('Asha');
  await expect(page.getByText('No matching attendance', { exact: true })).toBeVisible();
  // Summary counts remain shop-wide even when search has no matches.
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Absent, 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset register filters', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('attendance-register.png') });
  await tab(page, 'Team');
  await page.getByRole('button', { name: 'Edit Asha', exact: true }).click();
  await page.getByRole('switch', { name: 'Active worker', exact: true }).click();
  await page.getByRole('button', { name: 'Save worker', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Team status: Active, 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Team status: Inactive, 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Team status: All, 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toBeVisible();
  await tab(page, 'Account');
  await page.getByRole('button', { name: 'Create another shop', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Station Road');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await page
    .getByRole('button', { name: 'Switch shop, current shop: Station Road', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Switch to Market Road', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('shop-switcher.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close shop switcher', exact: true }).click();
  await tab(page, 'Team');
  await expect(page.getByText('Your team starts here', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Switch shop, current shop: Station Road', exact: true })
    .click();
  await page.getByRole('button', { name: 'Switch to Market Road', exact: true }).click();
  await tab(page, 'Team');
  await expect(
    page.getByRole('button', { name: 'Team status: Active, 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Ravi', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attendance · Asha', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: testInfo.outputPath('compact-header.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await tab(page, 'Register');
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Everyone, 2', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Attendance filter: Present, 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Update / history · Asha', exact: true }),
  ).toBeVisible();
});

test('owner profile, shop setup and verified mobile change preserve the account', async ({
  page,
}, testInfo) => {
  const suffix = String(Date.now()).slice(-8);
  const original = '+9188' + suffix;
  const replacement = '+9187' + suffix;
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Owner', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(original);
  await page.screenshot({ path: testInfo.outputPath('mobile-login.png') });
  await finishLogin(page, 'Owner', original);
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Patil Stores');
  await page.screenshot({ path: testInfo.outputPath('shop-setup.png') });
  await page.getByRole('button', { name: 'Change timezone', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Shop timezone', exact: true })).toHaveValue(
    'Asia/Kolkata',
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await expect(page.getByText('Patil Stores', { exact: true })).toBeVisible();
  await tab(page, 'Account');
  await expect(page.getByText('Prajwal', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit your name', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Prajwal Patil');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByText('Prajwal Patil', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('owner-account.png') });
  await page.getByRole('button', { name: 'Change mobile number', exact: true }).click();
  await page.getByRole('textbox', { name: 'New mobile number', exact: true }).fill(replacement);
  await page.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Send confirmation email', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email code', exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Confirm mobile change', exact: true }).click();
  await expect(
    page.getByText('Invalid or expired OTP. Request a new code if needed.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Email code', exact: true }).fill('123456');
  await page.screenshot({ path: testInfo.outputPath('change-mobile.png') });
  await page.getByRole('button', { name: 'Confirm mobile change', exact: true }).click();
  await expect(page.getByText('Your number is updated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to account', exact: true }).click();
  await expect(page.getByText(replacement, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'Owner', replacement);
  await expect(page.getByText('Patil Stores', { exact: true })).toBeVisible();
  await tab(page, 'Account');
  await expect(page.getByText('Prajwal Patil', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('country picker sends the selected calling code to password login', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Owner', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Country code: India +91', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('7911123456');
  await page.getByRole('button', { name: 'Country code: India +91', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search countries', exact: true }).fill('United Kingdom');
  await page.screenshot({
    path: testInfo.outputPath('country-picker.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'United Kingdom +44', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Mobile number', exact: true })).toHaveValue(
    '7911123456',
  );
  await expect(
    page.getByRole('button', { name: 'Country code: United Kingdom +44', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: testInfo.outputPath('phone-country-code.png') });
  const sent = page.waitForRequest(
    (req) => req.url().endsWith('/api/auth/password/options') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await sent).postDataJSON().mobile).toBe('+447911123456');
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use another mobile number', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('+919876543210');
  await expect(
    page.getByRole('button', { name: 'Country code: India +91', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mobile number', exact: true })).toHaveValue(
    '9876543210',
  );
});

async function cashEntry(page: Page, kind: string, amount: string, description: string) {
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('button', { name: `Transaction type: ${kind}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill(amount);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description);
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save transaction', exact: true })).toHaveCount(0);
}

test('daily Hishob closing, preserved history, corrections and manager permissions', async ({
  browser,
}, testInfo) => {
  test.setTimeout(150000);
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const manager = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const worker = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const suffix = String(Date.now()).slice(-8);
  const errors: string[] = [];
  for (const page of [owner, manager, worker]) page.on('pageerror', (e) => errors.push(e.message));
  await login(owner, 'Owner', '+9186' + suffix);
  await owner.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Hishob Cash Store');
  await owner.getByRole('button', { name: 'Create shop', exact: true }).click();
  await addPerson(owner, 'worker', 'Asha', '+9185' + suffix);
  await owner.getByRole('button', { name: 'Manage managers', exact: true }).click();
  await addPerson(owner, 'manager', 'Ravi', '+9184' + suffix);
  await back(owner);
  await login(manager, 'Manager', '+9184' + suffix);
  await expect(manager.getByText('MANAGER’S DESK', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Today’s Hishob', exact: true })).toHaveCount(0);
  await expect(manager.getByLabel('Hishob tab', { exact: true })).toHaveCount(0);
  await login(worker, 'Worker', '+9185' + suffix);
  await expect(worker.getByText('Hello, Asha', { exact: true })).toBeVisible();
  await expect(worker.getByRole('button', { name: 'Today’s Hishob', exact: true })).toHaveCount(0);
  await expect(worker.getByLabel('Hishob tab', { exact: true })).toHaveCount(0);
  await owner.getByRole('button', { name: 'Today’s Hishob', exact: true }).click();
  await owner.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('0');
  await owner.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  await cashEntry(owner, 'Cash sales', '15000', 'Daily cash sales');
  await cashEntry(owner, 'Expense', '500', 'Transport');
  await cashEntry(owner, 'Bank deposit', '2000', 'Bank cash deposit');
  await expect(owner.getByText('CURRENT GALLA', { exact: true })).toBeVisible();
  await expect(owner.getByText('₹12,500', { exact: true }).filter({ visible: true })).toBeVisible();
  await owner.screenshot({ path: testInfo.outputPath('today-hishob.png') });
  await owner.getByRole('button', { name: 'Close day', exact: true }).click();
  await owner.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('12300');
  await expect(owner.getByText('EXPECTED GALLA', { exact: true })).toBeVisible();
  await expect(owner.getByLabel('Difference -₹200', { exact: true })).toBeVisible();
  await expect(
    owner.getByRole('button', { name: 'Close today’s Hishob', exact: true }),
  ).toBeDisabled();
  await owner
    .getByRole('button', { name: 'Difference reason: Cash shortage', exact: true })
    .click();
  await owner.screenshot({ path: testInfo.outputPath('close-hishob.png') });
  await owner.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Add transaction', exact: true })).toHaveCount(0);
  await owner.getByRole('button', { name: 'Reopen day', exact: true }).click();
  await owner
    .getByRole('textbox', { name: 'Reopening reason', exact: true })
    .fill('Review expense receipt');
  await owner.getByRole('button', { name: 'Confirm reopening', exact: true }).click();
  await owner.getByRole('button', { name: 'View transactions (3)', exact: true }).click();
  await owner.getByRole('button', { name: 'Edit · Transport', exact: true }).click();
  await owner.getByRole('textbox', { name: 'Amount (₹)', exact: true }).fill('450');
  await owner
    .getByRole('textbox', { name: 'Correction reason', exact: true })
    .fill('Receipt says 450');
  await owner.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(owner.getByText('₹450', { exact: true })).toBeVisible();
  await cashEntry(owner, 'Expense', '0.10', 'Duplicate tea');
  await owner.getByRole('button', { name: 'Delete · Duplicate tea', exact: true }).click();
  await owner
    .getByRole('textbox', { name: 'Deletion reason', exact: true })
    .fill('Duplicate entry');
  await owner.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect(
    owner.getByRole('button', { name: 'Delete · Duplicate tea', exact: true }),
  ).toHaveCount(0);
  await owner.getByRole('button', { name: 'Entries: Include deleted', exact: true }).click();
  await expect(owner.getByText('Duplicate tea', { exact: true })).toBeVisible();
  await back(owner);
  await expect(owner.getByText('₹12,550', { exact: true })).toBeVisible();
  await owner.getByRole('button', { name: 'View closing 1', exact: true }).click();
  await expect(owner.getByText('₹12,500', { exact: true }).filter({ visible: true })).toBeVisible();
  await owner.getByRole('button', { name: 'View audit trail', exact: true }).click();
  await expect(owner.getByText('DELETE TRANSACTION', { exact: true })).toBeVisible();
  await expect(owner.getByText('Receipt says 450', { exact: true })).toBeVisible();
  await owner.getByText('DELETE TRANSACTION', { exact: true }).scrollIntoViewIfNeeded();
  await owner.screenshot({ path: testInfo.outputPath('hishob-audit.png') });
  // Switch directly out of Hishob to enable the manager's financial access.
  await tab(owner, 'Home');
  await tab(owner, 'Account');
  await owner.getByRole('button', { name: 'Shop settings', exact: true }).click();
  await owner.getByRole('switch', { name: 'Managers can access Hishob', exact: true }).click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await manager.getByRole('button', { name: 'Today’s Hishob', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Close day', exact: true })).toHaveCount(0);
  await expect(manager.getByLabel('Hishob tab', { exact: true })).toBeVisible();
  await expect(manager.getByRole('tab')).toHaveCount(5);
  await tab(manager, 'Account');
  await manager.getByRole('button', { name: 'My attendance', exact: true }).click();
  await expect(
    manager.getByText(
      'Your owner records your attendance. They can enable self-marking in Shop settings.',
      { exact: true },
    ),
  ).toBeVisible();
  await tab(manager, 'Hishob');
  await cashEntry(manager, 'Other cash in', '50', 'Extra float');
  await owner.getByRole('switch', { name: 'Managers can close Hishob', exact: true }).click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await manager.getByRole('button', { name: 'Close day', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('12600');
  await manager.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'View closing 2', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Reopen day', exact: true })).toHaveCount(0);
  await back(manager);
  await manager.getByRole('button', { name: 'Search transactions', exact: true }).click();
  await manager
    .getByRole('textbox', { name: 'Search transactions', exact: true })
    .fill('Extra float');
  await expect(manager.getByText('1 matching transaction', { exact: true })).toBeVisible();
  await owner.getByRole('switch', { name: 'Managers can access Hishob', exact: true }).click();
  await owner.getByRole('button', { name: 'Save shop settings', exact: true }).click();
  await expect(manager.getByText('MANAGER’S DESK', { exact: true })).toBeVisible();
  await back(owner);
  await owner.getByRole('button', { name: 'Hishob history', exact: true }).click();
  await owner.getByRole('button', { name: 'Hishob status: Closed, 1', exact: true }).click();
  await expect(owner.getByText('Difference ₹0', { exact: true })).toBeVisible();
  await owner.screenshot({ path: testInfo.outputPath('hishob-history.png') });
  await owner.getByRole('button', { name: 'History view: Date range', exact: true }).click();
  const fromDate = await owner
    .getByRole('textbox', { name: 'From date', exact: true })
    .inputValue();
  const toDate = await owner.getByRole('textbox', { name: 'To date', exact: true }).inputValue();
  await owner.getByRole('textbox', { name: 'From date', exact: true }).fill('2020-01-01');
  await owner.getByRole('textbox', { name: 'To date', exact: true }).fill('2020-01-31');
  await owner.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(owner.getByText('No Hishob days found', { exact: true })).toBeVisible();
  await owner.getByRole('textbox', { name: 'From date', exact: true }).fill(fromDate);
  await owner.getByRole('textbox', { name: 'To date', exact: true }).fill(toDate);
  await owner.getByRole('button', { name: 'Apply dates', exact: true }).click();

  await owner.getByRole('button', { name: /^Open Hishob · / }).click();
  await expect(owner.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await owner.close();
  await manager.close();
  await worker.close();
});

test('formatted cash inputs, calendar history and persistent detail-page tabs', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'Owner', '+9181' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Calendar Store');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await page.getByRole('button', { name: 'Today’s Hishob', exact: true }).click();
  const opening = page.getByRole('textbox', { name: 'Opening cash', exact: true });
  await opening.pressSequentially('125000.50');
  await expect(opening).toHaveValue('1,25,000.50');
  const startRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/hishob/days'),
  );
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  expect((await startRequest).postDataJSON().opening_cash).toBe('125000.50');
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^Hishob \d{4}-\d{2}-\d{2}, Open, Today$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Hishob status: Open, 1', exact: true }),
  ).toBeVisible();
  const futureDays = page.getByRole('button', { name: /, Future date$/ });
  for (const futureDay of await futureDays.all()) await expect(futureDay).toBeDisabled();
  await back(page);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const amount = page.getByRole('textbox', { name: 'Amount (₹)', exact: true });
  await amount.fill('999999999.99');
  await expect(amount).toHaveValue('99,99,99,999.99');
  await amount.press('End');
  await amount.pressSequentially('9');
  await expect(amount).toHaveValue('99,99,99,999.99');
  await amount.fill('');
  await amount.pressSequentially('12345.60');
  await expect(amount).toHaveValue('12,345.60');
  await amount.press('Backspace');
  await expect(amount).toHaveValue('12,345.6');
  await amount.fill('123456');
  for (let index = 0; index < 3; index++) await amount.press('ArrowLeft');
  expect(await amount.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(5);
  await amount.pressSequentially('98');
  await expect(amount).toHaveValue('1,23,98,456');
  await amount.fill('1,234.50');
  await expect(amount).toHaveValue('1,234.50');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Counter sales');
  await tab(page, 'Team');
  await expect(page.getByText('Your team', { exact: true })).toBeVisible();
  await tab(page, 'Hishob');
  await expect(amount).toHaveValue('1,234.50');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Counter sales',
  );
  const entryRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/transactions'),
  );
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  expect((await entryRequest).postDataJSON().amount).toBe('1234.50');
  await expect(
    page.getByText('₹1,26,235', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }).fill('126230.25');
  await expect(
    page.getByRole('textbox', { name: 'Actual cash in galla', exact: true }),
  ).toHaveValue('1,26,230.25');
  await expect(page.getByLabel('Difference -₹4.75', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Difference reason: Cash shortage', exact: true }).click();
  await page.getByRole('button', { name: 'Close today’s Hishob', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  // Every detail flow can leave through the tabs, without repeatedly pressing Back.
  await tab(page, 'Account');
  await page.getByRole('button', { name: 'Edit your name', exact: true }).click();
  await expect(page.getByLabel('Team tab', { exact: true })).toBeVisible();
  await tab(page, 'Team');
  await page.getByRole('button', { name: 'Add worker', exact: true }).click();
  await expect(page.getByLabel('Register tab', { exact: true })).toBeVisible();
  await tab(page, 'Register');
  await expect(page.getByText('Today’s attendance', { exact: true })).toBeVisible();
  await tab(page, 'Account');
  await back(page);
  await page.getByRole('button', { name: 'Shop settings', exact: true }).click();
  await expect(page.getByLabel('Home tab', { exact: true })).toBeVisible();
  await back(page);
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  const todayCell = page.getByRole('button', {
    name: /^Hishob \d{4}-\d{2}-\d{2}, Closed, Cash difference, Today$/,
  });
  await expect(todayCell).toBeVisible();
  await todayCell.click();
  await expect(page.getByText('Difference -₹4.75', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Hishob status: Closed, 1', exact: true }),
  ).toBeVisible();
  await todayCell.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('calendar-hishob.png') });
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(page.getByText('No Hishob days found', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /, Not started$/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Current month', exact: true }).click();
  await expect(todayCell).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next month', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Open Hishob · / }).click();
  await expect(page.getByRole('button', { name: 'View closing 1', exact: true })).toBeVisible();
  await tab(page, 'Home');
  // Re-selecting the active tab returns to its main page.
  await tab(page, 'Home');
  await expect(page.getByRole('button', { name: 'Today’s Hishob', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Hishob tab searches transactions by text, type and dates', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'Owner', '+9180' + String(Date.now()).slice(-8));
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Search Store');
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  await tab(page, 'Hishob');
  await expect(page.getByLabel('Hishob tab', { exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab')).toHaveCount(5);
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Start today’s Hishob', exact: true }).click();
  await cashEntry(page, 'Cash sales', '5000', 'Counter sales');
  await cashEntry(page, 'Expense', '1250', 'Fuel delivery');
  await cashEntry(page, 'Expense', '250', 'Staff tea');
  await page.getByRole('button', { name: 'Search transactions', exact: true }).click();
  await expect(page.getByText('3 matching transactions', { exact: true })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search transactions', exact: true });
  await search.fill('FUEL');
  await expect(page.getByText('1 matching transaction', { exact: true })).toBeVisible();
  await expect(page.getByText('Fuel delivery', { exact: true })).toBeVisible();
  await expect(page.getByText('Staff tea', { exact: true })).toHaveCount(0);
  await search.fill('Prajwal');
  await expect(page.getByText('3 matching transactions', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search transactions', exact: true }).click();
  await page.getByRole('button', { name: 'Filter transaction type: Expense', exact: true }).click();
  await expect(page.getByText('2 matching transactions', { exact: true })).toBeVisible();
  await expect(page.getByText('₹1,500', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: testInfo.outputPath('transaction-search.png') });
  await page.getByRole('button', { name: 'View day · Fuel delivery', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'View transactions (3)', exact: true }),
  ).toBeVisible();
  await back(page);
  await expect(page.getByText('2 matching transactions', { exact: true })).toBeVisible();
  await search.fill('nothing like this');
  await expect(page.getByText('No matching transactions', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset transaction search', exact: true }).click();
  await page.getByRole('button', { name: 'Search period: Choose dates', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search from date', exact: true }).fill('2020-01-01');
  await page.getByRole('textbox', { name: 'Search to date', exact: true }).fill('2020-01-31');
  await page.getByRole('button', { name: 'Apply search dates', exact: true }).click();
  await expect(page.getByText('No matching transactions', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search period: Today', exact: true }).click();
  await expect(page.getByText('3 matching transactions', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  await page.getByRole('button', { name: 'Search entries: Deleted only', exact: true }).click();
  await expect(page.getByText('No matching transactions', { exact: true })).toBeVisible();
  await tab(page, 'Home');
  await tab(page, 'Hishob');
  await expect(
    page.getByRole('textbox', { name: 'Search transactions', exact: true }),
  ).toBeVisible();
  await tab(page, 'Hishob');
  await page.getByRole('button', { name: 'View transactions (3)', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search this day’s transactions', exact: true })
    .fill('tea');
  await expect(page.getByText('Staff tea', { exact: true })).toBeVisible();
  await expect(page.getByText('Fuel delivery', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
