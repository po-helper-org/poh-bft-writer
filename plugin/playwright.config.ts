/**
 * E2E-прогоны раздела против живого харнесса (см. e2e/support/harness.ts, почему живого).
 *
 * Один воркер и без параллельности намеренно: все прогоны делят один документ настроек и
 * один композер, два теста одновременно затёрли бы друг другу значения. Браузер — системный
 * Chrome (`channel: 'chrome'`): ничего не скачивается, тот же движок, что у PO.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'e2e/.artifacts/test-results',
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
})
