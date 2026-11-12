import { defineConfig, devices } from '@playwright/test'

import { browserServer } from './browser-server'

const remoteBrowsers = browserServer()

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4178' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    ...(remoteBrowsers ? [remoteBrowsers] : []),
    {
      cwd: new URL('../..', import.meta.url).pathname,
      command:
        'bun --no-env-file x vite build --config tests/browser/vite.config.ts && bun --no-env-file x vite preview --config tests/browser/vite.config.ts --host 127.0.0.1 --port 4178 --strictPort',
      url: 'http://127.0.0.1:4178',
      timeout: 120_000,
    },
  ],
})
