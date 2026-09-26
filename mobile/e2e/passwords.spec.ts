import { expect, test } from '@playwright/test';
import { login, newPassword, setupCodes } from './auth-helpers';

test('owner issues staff setup, approves forgotten password, and recovers by email', async ({
  browser,
}, info) => {
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const worker = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const suffix = String(Date.now()).slice(-8);
  const ownerMobile = '+9198' + suffix,
    workerMobile = '+9197' + suffix;
  await login(owner, 'Owner', ownerMobile);
  await owner.getByRole('textbox', { name: 'Shop name', exact: true }).fill('Password Shop');
  await owner.getByRole('button', { name: 'Create shop', exact: true }).click();
  await owner.getByRole('button', { name: 'Add worker', exact: true }).click();
  await owner.getByRole('textbox', { name: 'Worker name', exact: true }).fill('Asha');
  await owner.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(workerMobile);
  await owner.getByRole('button', { name: 'Add worker', exact: true }).click();
  await owner.getByLabel('Team tab', { exact: true }).click();
  await owner.getByRole('button', { name: 'Password access · Asha', exact: true }).click();
  let issued = owner.waitForResponse('**/password-access');
  await owner.getByRole('button', { name: 'Generate setup code', exact: true }).click();
  const firstCode = (await (await issued).json()).setup_code;
  setupCodes.set(workerMobile, firstCode);
  await expect(owner.getByLabel(`Setup code ${firstCode}`, { exact: true })).toBeVisible();
  await owner.screenshot({ path: info.outputPath('staff-setup-code.png') });
  await login(worker, 'Worker', workerMobile);
  await expect(worker.getByText('Hello, Asha', { exact: true })).toBeVisible();
  await worker.getByLabel('Account tab', { exact: true }).click();
  await worker.getByRole('button', { name: 'Sign out', exact: true }).click();
  // A subsequent visit presents the password, not first-time setup.
  await worker.getByRole('button', { name: 'Continue as Worker', exact: true }).click();
  await worker.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(workerMobile);
  await worker.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(worker.getByLabel('Password', { exact: true })).toBeVisible();
  await worker.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await worker.getByRole('button', { name: 'Request password reset', exact: true }).click();
  await expect(worker.getByText(/Request sent/)).toBeVisible();
  await expect(
    owner.getByRole('button', { name: 'Approve password reset', exact: true }),
  ).toBeVisible();
  issued = owner.waitForResponse('**/password-access');
  await owner.getByRole('button', { name: 'Approve password reset', exact: true }).click();
  const resetCode = (await (await issued).json()).setup_code;
  await worker.getByRole('textbox', { name: 'Setup code', exact: true }).fill(resetCode);
  await newPassword(worker, 'a new worker passphrase 77');
  await worker.getByRole('button', { name: 'Set password & sign in', exact: true }).click();
  await expect(worker.getByText('Hello, Asha', { exact: true })).toBeVisible();
  await owner.getByLabel('Account tab', { exact: true }).click();
  await owner.getByRole('button', { name: 'Sign out', exact: true }).click();
  await owner.getByRole('button', { name: 'Continue as Owner', exact: true }).click();
  await owner.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await owner
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill(`${ownerMobile.slice(1)}@example.com`);
  await owner.getByRole('button', { name: 'Send email code', exact: true }).click();
  await owner.getByRole('textbox', { name: 'Email code', exact: true }).fill('123456');
  await newPassword(owner, 'a new owner passphrase 88');
  await owner.screenshot({ path: info.outputPath('owner-email-recovery.png') });
  await owner.getByRole('button', { name: 'Reset password & sign in', exact: true }).click();
  await expect(owner.getByText('Password Shop', { exact: true })).toBeVisible();
  await owner.close();
  await worker.close();
});
