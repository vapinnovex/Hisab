import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/pwa.spec.ts',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: 'http://localhost:8083',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: '../backend/.venv/bin/python ../backend/tests/serve_e2e.py',
      url: 'http://localhost:8001/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run build:web && node scripts/serve-pwa.cjs',
      url: 'http://localhost:8083',
      reuseExistingServer: false,
      timeout: 180000,
      env: { EXPO_PUBLIC_WEB_API_URL: '', CI: '1' },
    },
  ],
});
