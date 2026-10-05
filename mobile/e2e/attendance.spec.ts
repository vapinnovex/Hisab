import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

test('attendance date controls, compact filters and arrival/departure work on small screens', async ({
  page,
}, info) => {
  const suffix = String(Date.now()).slice(-8);
  await login(page, 'Owner', '+9198' + suffix);
  await page.getByLabel('Shop name', { exact: true }).fill('Attendance Studio');
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  const endpoint = `${response.url()}/${shop.id}`;
  const headers = { Origin: new URL(page.url()).origin, 'X-Hishob-Client': 'web' };
  expect(
    (
      await page.request.put(`${endpoint}/settings`, {
        headers,
        data: { attendance_mode: 'CHECK_IN_OUT' },
      })
    ).ok(),
  ).toBeTruthy();
  const people: string[] = [];
  for (const [name, prefix] of [
    ['Asha', '+9197'],
    ['Meera Lakshmi Narayanan', '+9196'],
    ['Ravi', '+9195'],
  ]) {
    const result = await page.request.post(`${endpoint}/workers`, {
      headers,
      data: { name, mobile: prefix + suffix },
    });
    expect(result.ok()).toBeTruthy();
    people.push((await result.json()).id);
  }
  const data = await (await page.request.get(`${endpoint}/attendance/today`)).json();
  expect(
    (
      await page.request.put(`${endpoint}/workers/${people[1]}/attendance`, {
        headers,
        data: { date: data.date, status: 'ABSENT' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByLabel('Attendance tab', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Everyone, 3', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeDisabled();
  const markIn = page.getByRole('button', { name: 'Mark in · Asha', exact: true });
  await expect(markIn).toBeInViewport();

  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      'Mark in · Asha',
      'Update / history · Asha',
      'Previous day',
      'Choose attendance date',
    ]) {
      const action = page.getByRole('button', { name, exact: true });
      await action.scrollIntoViewIfNeeded();
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByRole('button', { name: 'About attendance', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`attendance-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: 'Attendance filter: Absent, 1', exact: true }).click();
  await expect(page.getByText('Meera Lakshmi Narayanan', { exact: true })).toBeVisible();
  await expect(markIn).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Absent, 1', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: info.outputPath('attendance-long-name.png') });
  await page.getByRole('button', { name: 'Reset register filters', exact: true }).click();
  await page.getByRole('button', { name: 'About attendance', exact: true }).click();
  await expect(page.getByText(/Not marked means no entry yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'About attendance', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'About attendance', exact: true }).click();
  await markIn.click();
  const markOut = page.getByRole('button', { name: 'Mark out · Asha', exact: true });
  await expect(markOut).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Present, 1', exact: true }),
  ).toBeVisible();
  await markOut.click();
  await expect(markOut).toHaveCount(0);
  await expect(markIn).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Everyone, 0', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Everyone, 3', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Choose attendance date', exact: true }).click();
  const todayCell = page.getByRole('button', { name: new RegExp(`^Team attendance ${data.date}`) });
  await expect(todayCell).toContainText('× 1');
  await expect(todayCell).toHaveCSS('background-color', 'rgb(252, 226, 222)');
  await expect(todayCell).toHaveAttribute('aria-label', /Not marked: 1/);
  await page.screenshot({ path: info.outputPath('attendance-calendar-320.png') });
  for (const person of people) {
    expect(
      (
        await page.request.put(`${endpoint}/workers/${person}/attendance`, {
          headers,
          data: { date: data.date, status: 'PRESENT' },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await expect(todayCell).toContainText('✓');
  await expect(todayCell).toHaveCSS('background-color', 'rgb(220, 240, 226)');
  await page.screenshot({ path: info.outputPath('attendance-calendar-all-present-320.png') });
  const future = page.getByRole('button', { name: /^Team attendance / });
  for (const cell of await future.all()) {
    const label = await cell.getAttribute('aria-label');
    if (label!.slice(16, 26) > data.date) await expect(cell).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await page
    .getByRole('button', { name: /^Team attendance / })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Previous month', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to today', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Attendance filter: Everyone, 3', exact: true }),
  ).toBeVisible();
});
