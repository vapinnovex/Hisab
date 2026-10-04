import { expect, test } from '@playwright/test';
import { login, setupCodes } from './auth-helpers';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('owner pairs a restricted station, confirms enrollment, records and safely retries attendance, then revokes it', async ({
  page,
  browser,
}, info) => {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Face attendance shop');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const shop = await (await created).json();
  const api = `http://localhost:8001/api/shops/${shop.id}`;
  const headers = { 'X-Hishob-Client': 'web', Origin: 'http://localhost:8082' };
  const added = await page.request.post(`${api}/workers`, {
    headers,
    data: { name: 'Asha', mobile: '+9197' + String(Date.now()).slice(-8) },
  });
  expect(added.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Shop settings', exact: true }).click();
  await page.getByRole('button', { name: 'Face scan', exact: true }).click();
  const enable = page.getByRole('switch', { name: 'Enable face attendance', exact: true });
  await expect(enable).toBeDisabled();
  await page
    .getByRole('switch', { name: 'I understand supervised use is required', exact: true })
    .click();
  await enable.click();
  await expect(page.getByText('FACE ATTENDANCE ON', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('face-settings.png'), fullPage: true });
  await expect(page.getByLabel('Attendance station QR code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show station QR', exact: true }).click();
  await expect(page.getByLabel('Attendance station QR code')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Attendance station QR code').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('station-qr-320.png') });
  await page.getByRole('button', { name: 'Hide station QR', exact: true }).click();
  await expect(page.getByLabel('Attendance station QR code')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search employees', exact: true }).fill('nobody matches');
  await expect(page.getByText('No employees match your search.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search employees', exact: true }).click();
  await expect(page.getByText('Asha', { exact: true })).toBeVisible();
  await page.getByText('Face enrollments', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('enrollment-search-320.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const paired = page.waitForResponse(`${api}/face/pairing`);
  await page.getByRole('button', { name: 'Create pairing code', exact: true }).click();
  const code = (await (await paired).json()).code;
  const context = await browser.newContext({
    permissions: ['camera'],
    viewport: { width: 768, height: 1024 },
  });
  const station = await context.newPage();
  await station.goto('http://localhost:8001/api/face-station/');
  await station.getByLabel('Pairing code', { exact: true }).fill(code);
  await station.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(station.getByRole('heading', { name: 'Waiting for owner approval' })).toBeVisible();
  const confirmNumber = await station.locator('#confirmation').textContent();
  await expect(page.getByText(confirmNumber!, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve matching device', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await station.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(station.getByRole('button', { name: 'IN · Check in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Enroll face', exact: true }).click();
  await page.getByRole('switch', { name: 'Employee informed and identity checked' }).click();
  await page.getByRole('button', { name: 'Start supervised enrollment', exact: true }).click();
  await expect(station.getByRole('heading', { name: 'Enroll Asha' })).toBeVisible();
  await station.getByRole('button', { name: 'Capture face samples', exact: true }).click();
  await expect(
    station.getByText('Samples captured. Confirm enrollment in the main app.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm face enrollment', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.getByText('Face enrolled', { exact: true })).toBeVisible();
  await expect(station.getByRole('button', { name: 'IN · Check in' })).toBeVisible();
  let loseResponse = true;
  await station.route('**/face-station/scan', async (route) => {
    if (loseResponse) {
      loseResponse = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await station.getByRole('button', { name: 'IN · Check in' }).click();
  await expect(
    station.getByRole('button', { name: 'Retry the same attendance request' }),
  ).toBeVisible();
  await station.getByRole('button', { name: 'Retry the same attendance request' }).click();
  await expect(station.getByRole('status')).toContainText('Asha · Check-in recorded');
  const register = await (await page.request.get(`${api}/attendance/today`)).json();
  expect(register.rows[0].attendance.source).toBe('FACE');
  expect(register.rows[0].attendance.face_receipts).toHaveLength(1);
  for (const width of [320, 768]) {
    await station.setViewportSize({ width, height: 900 });
    expect(
      await station.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await station.screenshot({
      path: info.outputPath(`face-station-${width}.png`),
      fullPage: true,
    });
  }
  await page.screenshot({ path: info.outputPath('face-management.png'), fullPage: true });
  await context.setOffline(true);
  await expect(station.getByRole('button', { name: 'IN · Check in' })).toBeDisabled();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Revoke device', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(station.getByRole('heading', { name: 'Connect your shop' })).toBeVisible();
  expect(
    await station.locator('video').evaluate((video: HTMLVideoElement) => video.srcObject),
  ).toBeNull();
  const person = register.rows[0].worker;
  expect(
    (
      await page.request.put(`${api}/workers/${person.id}/attendance`, {
        headers,
        data: { date: register.date, status: 'HALF_DAY', note: 'Owner approved appointment' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByLabel('Attendance tab', { exact: true }).click();
  await page.getByRole('button', { name: 'Attendance activity', exact: true }).click();
  await expect(page.getByText('Owner approved appointment', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Attendance source: Face scans', exact: true }).click();
  await expect(page.getByText('Arrival recorded · Face scan', { exact: true })).toBeVisible();
  await expect(page.getByText('Owner approved appointment', { exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Attendance source: Manual entries', exact: true })
    .click();
  await expect(
    page.getByText('Attendance corrected · Manual entry', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search attendance activity', { exact: true }).fill('does not exist');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByText('No attendance activity matches these filters.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search attendance activity', { exact: true }).fill('appointment');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Owner approved appointment', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('attendance-activity-320.png'), fullPage: true });
  await context.close();
});

test('manager home exposes face attendance with owner-controlled enrollment permissions', async ({
  page,
  browser,
}, info) => {
  const suffix = String(Date.now()).slice(-8);
  await login(page, 'Owner', '+9198' + suffix);
  await page.getByLabel('Shop name', { exact: true }).fill('Manager face shop');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const shop = await (await created).json();
  const base = `http://localhost:8001/api/shops/${shop.id}`;
  const headers = { 'X-Hishob-Client': 'web', Origin: 'http://localhost:8082' };
  const managerMobile = '+9196' + suffix;
  const managerResponse = await page.request.post(`${base}/managers`, {
    headers,
    data: { name: 'Maya', mobile: managerMobile },
  });
  expect(managerResponse.ok()).toBeTruthy();
  const manager = await managerResponse.json();
  const worker = await page.request.post(`${base}/workers`, {
    headers,
    data: { name: 'Worker Asha', mobile: '+9197' + suffix },
  });
  expect(worker.ok()).toBeTruthy();
  const access = await page.request.post(`${base}/team/${manager.id}/password-access`, { headers });
  setupCodes.set(managerMobile, (await access.json()).setup_code);
  const attendanceSettings = await (await page.request.get(`${base}/settings`)).json();
  expect(
    (
      await page.request.put(`${base}/settings`, {
        headers,
        data: { ...attendanceSettings, manager_can_mark_own_attendance: true },
      })
    ).ok(),
  ).toBeTruthy();
  const managerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const managerPage = await managerContext.newPage();
  await login(managerPage, 'Manager', managerMobile);
  await managerPage.getByRole('button', { name: 'Face attendance', exact: true }).click();
  await expect(managerPage.getByText('Your manager access', { exact: true })).toBeVisible();
  await expect(
    managerPage.getByText('Ask the owner to enable worker face enrollment for managers.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(managerPage.getByRole('switch', { name: 'Enable face attendance' })).toHaveCount(0);
  await expect(
    managerPage.getByRole('button', { name: 'Create pairing code', exact: true }),
  ).toHaveCount(0);
  await expect(managerPage.getByRole('button', { name: 'Enroll face', exact: true })).toHaveCount(
    0,
  );
  const current = await (await page.request.get(`${base}/face`)).json();
  const updated = await page.request.put(`${base}/face/settings`, {
    headers,
    data: {
      revision: current.revision,
      enabled: true,
      manager_can_enroll_workers: true,
      allow_manager_attendance: true,
      supervised_use_acknowledged: true,
    },
  });
  expect(updated.ok()).toBeTruthy();
  const pair = await page.request.post(`${base}/face/pairing`, { headers, data: {} });
  const stationContext = await browser.newContext();
  const station = await stationContext.request.post('http://localhost:8001/api/face-station/pair', {
    headers: { ...headers, Origin: 'http://localhost:8001' },
    data: { code: (await pair.json()).code, name: 'Manager station' },
  });
  expect(station.ok()).toBeTruthy();
  const devices = (await (await page.request.get(`${base}/face`)).json()).devices;
  expect(
    (
      await page.request.post(`${base}/face/devices/${devices[0].id}/approve`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBeTruthy();
  await expect(
    managerPage.getByText('You can enroll workers and confirm the enrollments you start.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(managerPage.getByRole('button', { name: 'Enroll face', exact: true })).toHaveCount(
    1,
  );
  await expect(managerPage.getByRole('button', { name: 'Enroll face', exact: true })).toBeEnabled();
  await expect(managerPage.getByRole('button', { name: 'Revoke device', exact: true })).toHaveCount(
    0,
  );
  await managerPage.getByRole('button', { name: 'Show station QR', exact: true }).click();
  await expect(managerPage.getByLabel('Attendance station QR code')).toBeVisible();
  await managerPage.getByRole('button', { name: 'Hide station QR', exact: true }).click();
  await managerPage.getByText('Your manager access', { exact: true }).scrollIntoViewIfNeeded();
  await managerPage.screenshot({ path: info.outputPath('manager-face-access.png') });
  await managerPage.getByRole('button', { name: 'Enroll face', exact: true }).click();
  await managerPage.getByRole('switch', { name: 'Employee informed and identity checked' }).click();
  await managerPage
    .getByRole('button', { name: 'Start supervised enrollment', exact: true })
    .click();
  await expect(managerPage.getByText('Enrollment: Worker Asha', { exact: true })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Cancel enrollment', exact: true }).click();
  await expect(managerPage.getByText('Enrollment: Worker Asha', { exact: true })).toHaveCount(0);
  await managerPage.getByLabel('Home tab', { exact: true }).click();
  await managerPage.getByRole('button', { name: 'My attendance', exact: true }).click();
  await expect(
    managerPage.getByText(
      'Face attendance is enabled. Use the shop station to scan IN or OUT. Only the owner can make manual corrections.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    managerPage.getByRole('button', { name: 'Mark my arrival', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await managerPage.request.post(`${base}/me/attendance/check-in`, { headers, data: {} })
    ).status(),
  ).toBe(403);
  await managerPage.getByLabel('Attendance tab', { exact: true }).click();
  await managerPage.getByRole('button', { name: 'Attendance activity', exact: true }).click();
  await expect(
    managerPage.getByText('No attendance activity matches these filters.', { exact: true }),
  ).toBeVisible();
  await managerContext.close();
  await stationContext.close();
});

test('shop links block the previous station and permit an explicit shop switch', async ({
  page,
  browser,
}, info) => {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Lalpotu Collection');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const first = await (await created).json();
  const root = 'http://localhost:8001/api';
  const headers = { 'X-Hishob-Client': 'web', Origin: 'http://localhost:8082' };
  const second = await (
    await page.request.post(`${root}/shops`, {
      headers,
      data: { name: 'Nampali', timezone: 'Asia/Kolkata' },
    })
  ).json();
  const codes: Record<string, string> = {};
  for (const shop of [first, second]) {
    const config = await (await page.request.get(`${root}/shops/${shop.id}/face`)).json();
    expect(
      (
        await page.request.put(`${root}/shops/${shop.id}/face/settings`, {
          headers,
          data: {
            revision: config.revision,
            enabled: true,
            manager_can_enroll_workers: false,
            allow_manager_attendance: false,
            supervised_use_acknowledged: true,
          },
        })
      ).ok(),
    ).toBeTruthy();
    codes[shop.id] = (
      await (
        await page.request.post(`${root}/shops/${shop.id}/face/pairing`, { headers, data: {} })
      ).json()
    ).code;
  }
  const context = await browser.newContext();
  const original = await context.newPage();
  await original.goto(`${root}/face-station/?shop=${first.id}`);
  await expect(
    original.getByRole('heading', { name: 'Lalpotu Collection', exact: true }),
  ).toBeVisible();
  await original.getByLabel('Pairing code', { exact: true }).fill(codes[first.id]);
  await original.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(original.getByRole('heading', { name: 'Waiting for owner approval' })).toBeVisible();
  const approve = async (shop: string) => {
    const device = (await (await page.request.get(`${root}/shops/${shop}/face`)).json()).devices[0]
      .id;
    expect(
      (
        await page.request.post(`${root}/shops/${shop}/face/devices/${device}/approve`, {
          headers,
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
  };
  await approve(first.id);
  await expect(original.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible();
  const target = await context.newPage();
  await target.goto(`${root}/face-station/?shop=${second.id}`);
  await expect(target.getByRole('heading', { name: 'Nampali', exact: true })).toBeVisible();
  await expect(target.getByRole('heading', { name: 'Different shop connected' })).toBeVisible();
  await expect(target.getByText(/this browser is paired to Lalpotu Collection/)).toBeVisible();
  await expect(target.getByRole('button', { name: 'IN · Check in' })).toBeHidden();
  await target.setViewportSize({ width: 320, height: 844 });
  expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await target.screenshot({
    path: info.outputPath('station-shop-conflict-320.png'),
    fullPage: true,
  });
  await target.getByRole('button', { name: 'Disconnect station', exact: true }).click();
  await target
    .getByRole('button', { name: 'Disconnect and enter a pairing code', exact: true })
    .click();
  await expect(target.getByRole('heading', { name: 'Connect your shop' })).toBeVisible();
  await target.getByLabel('Pairing code', { exact: true }).fill(codes[second.id]);
  await target.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(target.getByRole('heading', { name: 'Waiting for owner approval' })).toBeVisible();
  await approve(second.id);
  await expect(target.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible();
  await original.reload();
  await expect(original.getByRole('heading', { name: 'Different shop connected' })).toBeVisible();
  await expect(original.getByRole('button', { name: 'IN · Check in' })).toBeHidden();
  const generic = await context.newPage();
  await generic.goto(`${root}/face-station/`);
  await expect(
    generic.getByRole('heading', { name: 'Confirm your attendance shop' }),
  ).toBeVisible();
  await expect(generic.getByRole('button', { name: 'IN · Check in' })).toBeHidden();
  await generic.getByRole('button', { name: 'Continue with this shop', exact: true }).click();
  await expect(generic).toHaveURL(`${root}/face-station/?shop=${second.id}`);
  await expect(generic.getByRole('heading', { name: 'Nampali', exact: true })).toBeVisible();
  const oldState = await (await page.request.get(`${root}/shops/${first.id}/face`)).json();
  expect(oldState.devices).toHaveLength(0);
  expect(oldState.events.some((e: { action: string }) => e.action === 'DEVICE_DISCONNECTED')).toBe(
    true,
  );
  await context.close();
});
