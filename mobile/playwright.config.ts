import { defineConfig } from '@playwright/test';
const apiUrl = `http://localhost:${process.env.HISHOB_E2E_API_PORT || '8001'}`;
export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/pwa.spec.ts',
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
      command: `"${process.env.HISHOB_BACKEND_PYTHON || (process.platform === 'win32' ? '..\\backend\\.venv\\Scripts\\python.exe' : '../backend/.venv/bin/python')}" ../backend/tests/serve_e2e.py`,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npx expo start --web --port 8082',
      url: 'http://localhost:8082',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        EXPO_PUBLIC_API_URL: apiUrl,
        EXPO_PUBLIC_WEB_API_URL: apiUrl,
        CI: '1',
        BROWSER: 'none',
        EXPO_OFFLINE: '1',
      },
    },
  ],
});
