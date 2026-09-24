import { expect, test, Page } from '@playwright/test';

async function login(page: Page, role: 'Owner' | 'Manager' | 'Worker', mobile: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Continue as ${role}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(mobile);
  await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  await page.getByRole('textbox', { name: 'OTP code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
}
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
  await owner.getByRole('textbox', { name: 'Your name', exact: true }).fill('Prajwal');
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
    await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
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
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Prajwal');
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
  await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  await page.getByRole('textbox', { name: 'OTP code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Patil Stores');
  await expect(page.getByRole('button', { name: 'Create shop', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Prajwal');
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
  await page.getByRole('button', { name: 'Verify current number', exact: true }).click();
  await expect(page.getByText('Verify your current number', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify & send new OTP', exact: true }).click();
  await expect(
    page.getByText('Invalid or expired OTP. Request a new code if needed.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & send new OTP', exact: true }).click();
  await expect(page.getByText('Verify your new number', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('123456');
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

test('country picker sends the selected calling code to OTP', async ({ page }, testInfo) => {
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
    (req) => req.url().endsWith('/api/auth/otp/request') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  expect((await sent).postDataJSON().mobile).toBe('+447911123456');
  await expect(page.getByRole('textbox', { name: 'OTP code', exact: true })).toBeVisible();
  await expect(page.getByText(/Enter the 6-digit code for \+447911123456/)).toBeVisible();
  await page.getByRole('button', { name: 'Change mobile number', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill('+919876543210');
  await expect(
    page.getByRole('button', { name: 'Country code: India +91', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mobile number', exact: true })).toHaveValue(
    '9876543210',
  );
});
