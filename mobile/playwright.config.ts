import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: 'http://localhost:8082',
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
      command: 'npx expo start --web --port 8082',
      url: 'http://localhost:8082',
      reuseExistingServer: false,
      timeout: 120000,
      env: { EXPO_PUBLIC_API_URL: 'http://localhost:8001', CI: '1' },
    },
  ],
});
