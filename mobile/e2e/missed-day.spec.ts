import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { login } from './auth-helpers';

test('owner starts a missed date from history and records its transactions', async ({
  page,
}, info) => {
  await login(page, 'Owner', '+9198' + String(Date.now()).slice(-8));
  await page.getByLabel('Shop name', { exact: true }).fill('Missed day shop');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/shops'),
  );
  await page.getByRole('button', { name: 'Create shop', exact: true }).click();
  const response = await created;
  const shop = await response.json();
  // Age only this shop in the isolated browser-test database.
  execFileSync(
    process.platform === 'win32'
      ? '../backend/.venv/Scripts/python.exe'
      : '../backend/.venv/bin/python',
    [
      '-c',
      `
import os, sys
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient
with MongoClient(os.getenv('TEST_MONGODB_URI', 'mongodb://127.0.0.1:27018')) as client:
    for name in client.list_database_names():
        if name.startswith('hisab_e2e_'):
            result = client[name].shops.update_one({'_id': sys.argv[1]}, {'$set': {'created_at': datetime.now(timezone.utc) - timedelta(days=3)}})
            if result.matched_count:
                break
    else:
        raise RuntimeError('Isolated test shop not found')
`,
      shop.id,
    ],
  );
  const endpoint = `${response.url()}/${shop.id}/hishob`;
  const today = (await (await page.request.get(`${endpoint}/today`)).json()).date;
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const missed = previous.toISOString().slice(0, 10);
  await page.reload();
  await page.getByLabel('Hishob tab', { exact: true }).click();
  await page.getByRole('button', { name: 'Hishob history', exact: true }).click();
  if (missed.slice(0, 7) !== today.slice(0, 7)) {
    await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  }
  await page.getByRole('button', { name: `Hishob ${missed}, Not started`, exact: true }).click();
  await page.getByRole('button', { name: `Start missed day · ${missed}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Opening cash', exact: true }).fill('100');
  await page
    .getByLabel('Reason for opening missed day', { exact: true })
    .fill('Forgot to start yesterday');
  await page.screenshot({ path: info.outputPath('missed-day-form.png'), fullPage: true });
  await page.getByRole('button', { name: `Start Hishob · ${missed}`, exact: true }).click();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByLabel('Amount (₹)', { exact: true }).fill('50');
  await page.getByLabel('Description', { exact: true }).fill('Missed cash sale');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
  const days = await (
    await page.request.get(`${endpoint}/days?from_date=${missed}&to_date=${missed}`)
  ).json();
  const day = await (await page.request.get(`${endpoint}/days/${days[0].id}`)).json();
  expect(day.date).toBe(missed);
  expect(day.transactions[0].description).toBe('Missed cash sale');
  expect(day.transactions[0].date).toBe(missed);
  expect(day.audit[0].reason).toBe('Forgot to start yesterday');
  expect((await (await page.request.get(`${endpoint}/today`)).json()).day).toBeNull();
  await page.getByRole('button', { name: 'Close day', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Close Hishob · ${missed}`, exact: true }),
  ).toBeVisible();
});
